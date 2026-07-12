/**
 * timeline-query.test.mjs
 *
 * F-042 — Unit tests for the `timeline_query` MCP tool. Run with:
 *   node --test packages/sdk/tests/timeline-query.test.mjs
 *
 * Cases (4 total):
 *   1. MCP tool resolves with HTTP loopback (mocked server)
 *   2. MCP tool falls back to JSONL on HTTP failure
 *   3. Output shape: returns both prose summary + JSON dump
 *   4. limit param clamps to 1..500
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

import {
  handleTimelineQuery,
  __testHelpers,
} from '../dist/mcp/tools/timeline-query.js';

function startMockDashboard(handler) {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function stop(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

test('timeline_query resolves via HTTP loopback', async () => {
  const fakeEvents = [
    {
      id: 'evt_http_1',
      ts: '2026-07-12T10:00:00Z',
      type: 'task',
      subType: 'task-created',
      summary: 'http test',
      refs: { taskId: 'tsk_http' },
      actor: { kind: 'user', name: 'tester' },
      source: 'mock',
      sourceId: 'mock-http-1',
    },
  ];
  const { server, url } = await startMockDashboard((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ events: fakeEvents, total: 1, limit: 50, offset: 0 }));
  });
  try {
    const result = await handleTimelineQuery(
      { limit: 10 },
      { dashboardUrl: url, httpGetJson: undefined },
    );
    assert.ok(result.content);
    assert.equal(result.content.length, 1);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.source, 'dashboard');
    assert.equal(payload.total, 1);
    assert.equal(payload.events.length, 1);
    assert.equal(payload.events[0].id, 'evt_http_1');
    assert.ok(typeof payload.summary === 'string' && payload.summary.length > 0);
  } finally {
    await stop(server);
  }
});

test('timeline_query falls back to JSONL on HTTP failure', async () => {
  // Point at a non-existent port → httpGetJson rejects → fallback.
  const tmp = mkdtempSync(join(tmpdir(), 'f042-mcp-fallback-'));
  try {
    const file = join(tmp, 'timeline.jsonl');
    const events = [
      {
        id: 'evt_fb_1',
        ts: '2026-07-12T10:00:00Z',
        type: 'agent',
        subType: 'agent-spawned',
        summary: 'fallback agent',
        refs: { agentName: 'coder' },
        actor: { kind: 'agent', name: 'coder' },
        source: 'fb-test',
        sourceId: 'fb-1',
      },
      {
        id: 'evt_fb_2',
        ts: '2026-07-12T10:01:00Z',
        type: 'task',
        subType: 'task-completed',
        summary: 'fallback task',
        refs: { taskId: 'tsk_fb' },
        actor: { kind: 'user' },
        source: 'fb-test',
        sourceId: 'fb-2',
      },
    ];
    writeFileSync(file, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    const result = await handleTimelineQuery(
      { limit: 10 },
      {
        dashboardUrl: 'http://127.0.0.1:1',
        httpGetJson: () => Promise.reject(new Error('connect refused')),
        timelineFile: file,
      },
    );
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.source, 'local');
    assert.ok(payload.events.length >= 1);
    assert.ok(payload.events.some((e) => e.id === 'evt_fb_1') || payload.events.some((e) => e.id === 'evt_fb_2'));
    assert.ok(typeof payload.summary === 'string');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('timeline_query output shape includes prose summary + JSON dump', async () => {
  const { server, url } = await startMockDashboard((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      events: [
        { id: 'e1', ts: '2026-07-12T10:00:00Z', type: 'task', subType: 'task-created', summary: 'one', refs: {}, actor: { kind: 'user' }, source: 'mock', sourceId: 'm1' },
        { id: 'e2', ts: '2026-07-12T10:01:00Z', type: 'task', subType: 'task-completed', summary: 'two', refs: {}, actor: { kind: 'user' }, source: 'mock', sourceId: 'm2' },
      ],
      total: 2, limit: 50, offset: 0,
    }));
  });
  try {
    const result = await handleTimelineQuery({}, { dashboardUrl: url });
    const payload = JSON.parse(result.content[0].text);
    assert.ok(Array.isArray(payload.events), 'events is an array');
    assert.ok(typeof payload.summary === 'string' && payload.summary.length > 0, 'summary is non-empty prose');
    // The summary should mention the type breakdown.
    assert.ok(payload.summary.includes('task') || payload.summary.includes('events'));
  } finally {
    await stop(server);
  }
});

test('limit param clamps to 1..500', () => {
  assert.equal(__testHelpers.clampLimit(undefined), 50);
  assert.equal(__testHelpers.clampLimit(0), 50);
  assert.equal(__testHelpers.clampLimit(-10), 50);
  assert.equal(__testHelpers.clampLimit(1), 1);
  assert.equal(__testHelpers.clampLimit(100), 100);
  assert.equal(__testHelpers.clampLimit(500), 500);
  assert.equal(__testHelpers.clampLimit(501), 500);
  assert.equal(__testHelpers.clampLimit(99999), 500);
});
