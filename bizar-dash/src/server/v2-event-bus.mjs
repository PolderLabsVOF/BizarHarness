/**
 * src/server/v2-event-bus.mjs
 *
 * v0.7.0-alpha.1 — In-memory event bus for the v2 SSE protocol.
 *
 * Buffers the last N events for late subscribers (replay via `?since=`).
 * New subscribers get the buffer + live events.
 *
 * Replaces the file-based serve.json bridge for plugin→dashboard
 * communication (the file bridge remains as fallback for v1 consumers).
 */

import { EventEmitter } from 'node:events';

const BUFFER_LIMIT = 100;

export class V2EventBus {
  constructor({ bufferLimit = BUFFER_LIMIT, logger = console } = {}) {
    this.bufferLimit = bufferLimit;
    this.logger = logger;
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(0); // unlimited subscribers
    this.buffer = []; // [{ seq, type, properties, publishedAt }]
    this.seq = 0;
  }

  /**
   * Publish an event. Returns the assigned sequence number.
   *
   * @param {{ type: string, properties: object }} event
   * @returns {number} sequence number
   */
  publish(event) {
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') {
      throw new TypeError('V2EventBus.publish: event must have a string `type` field');
    }
    this.seq += 1;
    const record = {
      seq: this.seq,
      type: event.type,
      properties: event.properties ?? {},
      publishedAt: Date.now(),
    };
    this.buffer.push(record);
    if (this.buffer.length > this.bufferLimit) {
      this.buffer.shift();
    }
    this.emitter.emit('event', record);
    return record.seq;
  }

  /**
   * Subscribe to live events.
   *
   * @param {object} opts
   * @param {number} [opts.since] - replay events with seq > since (from buffer)
   * @param {AbortSignal} [opts.signal] - abort signal to close subscription
   * @returns {{ events: AsyncIterable, close: () => void }}
   */
  subscribe({ since, signal } = {}) {
    const replay = typeof since === 'number'
      ? this.buffer.filter((r) => r.seq > since)
      : [];
    const queue = [...replay];
    const liveListeners = [];
    let closed = false;

    const onAbort = () => close();
    if (signal) {
      if (signal.aborted) {
        // already aborted
        return { events: emptyAsyncIterable(), close: () => {} };
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const onEvent = (record) => {
      if (!closed) queue.push(record);
    };
    this.emitter.on('event', onEvent);
    liveListeners.push(() => this.emitter.off('event', onEvent));

    const close = () => {
      if (closed) return;
      closed = true;
      for (const off of liveListeners) off();
      if (signal) signal.removeEventListener('abort', onAbort);
    };

    return {
      events: drainQueue(queue, close),
      close,
    };
  }

  /** Total events published since bus start. */
  size() {
    return this.seq;
  }

  /** Number of buffered events currently held for replay. */
  bufferSize() {
    return this.buffer.length;
  }
}

async function* drainQueue(queue, onEnd) {
  try {
    while (queue.length > 0) {
      yield queue.shift();
    }
    // After replay, switch to live: block until queue has items or close()
    while (true) {
      if (queue.length > 0) {
        yield queue.shift();
        continue;
      }
      // wait briefly then check again
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } finally {
    if (onEnd) onEnd();
  }
}

async function* emptyAsyncIterable() {
  // no-op
}
