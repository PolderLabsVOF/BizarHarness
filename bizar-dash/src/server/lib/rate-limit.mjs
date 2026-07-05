/**
 * src/server/lib/rate-limit.mjs
 *
 * v4.8.0 — Per-IP token bucket rate limiter for /api/chat and /api/v2/event.
 *
 * Implementation notes
 * ────────────────────
 * Each scope + remote IP pair gets its own bucket. Buckets refill
 * continuously at `refillPerSecond` tokens / second, capped at
 * `capacity`. Every accepted request consumes one token; rejected
 * requests do not consume, and include `Retry-After` so polite clients
 * can back off.
 *
 * Why a token bucket and not a sliding window?
 *   - O(1) memory per IP (two floats + a timestamp).
 *   - Refill is implicit — no periodic timer, no sweep job.
 *   - Burst tolerance is built in (up to `capacity` in one go).
 *
 * Headers set on every accepted response:
 *   - X-RateLimit-Limit       : capacity
 *   - X-RateLimit-Remaining   : Math.floor(tokens) after consumption
 *   - X-RateLimit-Reset       : seconds until full (omitted on success
 *                               because it's not well-defined at
 *                               `capacity`; only emitted on 429)
 *
 * Headers set on a 429 response:
 *   - Retry-After             : seconds until 1 token is available
 *   - X-RateLimit-Limit       : capacity
 *   - X-RateLimit-Remaining   : 0
 *   - X-RateLimit-Reset       : seconds until 1 token is available
 *
 * The bucket map is process-global. Tests call `clearBuckets()` to
 * reset between cases so they don't leak state.
 */

const buckets = new Map();

/**
 * @param {object} opts
 * @param {number} opts.capacity         — max tokens per bucket
 * @param {number} opts.refillPerSecond  — tokens added per second
 * @param {string} [opts.scope='global'] — bucket-key prefix; isolates chat vs event buckets
 * @returns {import('express').RequestHandler}
 */
export function createRateLimiter({ capacity, refillPerSecond, scope = 'global' }) {
  if (!Number.isFinite(capacity) || capacity <= 0) {
    throw new TypeError('createRateLimiter: capacity must be a positive number');
  }
  if (!Number.isFinite(refillPerSecond) || refillPerSecond <= 0) {
    throw new TypeError('createRateLimiter: refillPerSecond must be a positive number');
  }
  if (typeof scope !== 'string' || !scope) {
    throw new TypeError('createRateLimiter: scope must be a non-empty string');
  }

  return function rateLimit(req, res, next) {
    const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    const key = `${scope}:${ip}`;
    const now = Date.now();
    const bucket = buckets.get(key) || { tokens: capacity, lastRefill: now };

    // Refill based on elapsed wall-clock time. Cap at capacity.
    const elapsedSec = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSec * refillPerSecond);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      // Compute retry-after: seconds until we have at least 1 token.
      const deficit = 1 - bucket.tokens;
      const retryAfterSec = Math.max(1, Math.ceil(deficit / refillPerSecond));
      res.set('Retry-After', String(retryAfterSec));
      res.set('X-RateLimit-Limit', String(capacity));
      res.set('X-RateLimit-Remaining', '0');
      res.set('X-RateLimit-Reset', String(retryAfterSec));
      // Persist the (still-empty) bucket so subsequent calls also see 0.
      buckets.set(key, bucket);
      // The 429 response carries the rate-limit scope so the operator
      // can tell chat-throttling from event-throttling in logs.
      res.set('X-RateLimit-Scope', scope);
      res.status(429).json({
        error: 'rate_limited',
        message: 'Too many requests',
        scope,
        retryAfter: retryAfterSec,
      });
      return;
    }

    bucket.tokens -= 1;
    buckets.set(key, bucket);
    res.set('X-RateLimit-Limit', String(capacity));
    res.set('X-RateLimit-Remaining', String(Math.floor(bucket.tokens)));
    res.set('X-RateLimit-Scope', scope);
    next();
  };
}

/**
 * Reset all buckets. Tests call this in setup/teardown to avoid
 * leaking state between cases. Production code should not need it.
 */
export function clearBuckets() {
  buckets.clear();
}

/**
 * Inspect a single bucket. Returns undefined if no requests have been
 * recorded for `key` yet. Exported for tests only.
 *
 * @param {string} key
 */
export function _peekBucket(key) {
  return buckets.get(key);
}

/**
 * Total number of buckets currently tracked. Exported for tests /
 * observability.
 */
export function _bucketSize() {
  return buckets.size;
}