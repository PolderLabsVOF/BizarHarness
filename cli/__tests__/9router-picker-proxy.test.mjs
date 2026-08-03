// Tests for the 9router picker proxy. Each test sets the env-driven port
// overrides BEFORE importing the proxy module, because the proxy reads its
// constants at module-init time. Ephemeral ports (port 0) keep tests
// conflict-free.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';

const HOST = '127.0.0.1';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, HOST, resolve));
  return { server, port: server.address().port };
}

async function close(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
}

function httpReq(port, opts) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: HOST,
      port,
      method: opts.method ?? 'GET',
      path: opts.path ?? '/',
      headers: opts.headers ?? {},
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    if (opts.body !== undefined) req.end(opts.body);
    else req.end();
  });
}

async function loadProxy(upstreamPort) {
  process.env.BIZAR_PICKER_PROXY_TEST_LISTEN_PORT = '0';
  process.env.BIZAR_PICKER_PROXY_TEST_LISTEN_HOST = HOST;
  process.env.BIZAR_PICKER_PROXY_TEST_UPSTREAM_HOST = HOST;
  process.env.BIZAR_PICKER_PROXY_TEST_UPSTREAM_PORT = String(upstreamPort);
  const cacheBust = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return import(`../commands/9router-picker-proxy.mjs?cache=${cacheBust}`);
}

test('rewriteIds prefixes non-claude/anthropic IDs with `claude-` and preserves claude/anthropic prefixes', async () => {
  const cacheBust = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { rewriteIds } = await import(`../commands/9router-picker-proxy.mjs?cache=${cacheBust}`);
  const parsed = { data: [
    { id: 'gpt-5.6-luna' },
    { id: 'claude-sonnet-5' },
    { id: 'anthropic-test' },
    { id: 42 },
    {},
  ] };
  rewriteIds(parsed);
  const ids = parsed.data.map((m) => m.id);
  assert.deepEqual(ids, ['claude-gpt-5.6-luna', 'claude-sonnet-5', 'anthropic-test', 42, undefined]);
});

test('picker proxy rewrites /v1/models IDs through the live proxy', async (t) => {
  const fakeUpstream = await listen(createServer((req, res) => {
    if (req.method === 'GET' && req.url?.startsWith('/v1/models')) {
      const payload = { data: [
        { id: 'gpt-5.6-luna' },
        { id: 'claude-sonnet-5' },
        { id: 'anthropic-test' },
      ] };
      const out = JSON.stringify(payload);
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(out) });
      res.end(out);
      return;
    }
    res.writeHead(404); res.end();
  }));

  const { createProxyServer } = await loadProxy(fakeUpstream.port);
  const proxy = createProxyServer();
  const bound = await listen(proxy);

  t.after(async () => {
    await close(bound.server);
    await close(fakeUpstream.server);
  });

  const res = await httpReq(bound.port, { path: '/v1/models' });
  assert.equal(res.status, 200);
  const json = JSON.parse(res.body);
  assert.deepEqual(json.data.map((m) => m.id), [
    'claude-gpt-5.6-luna',
    'claude-sonnet-5',
    'anthropic-test',
  ]);
});

test('picker proxy forwards POST /v1/messages body byte-for-byte', async (t) => {
  let captured = null;
  const fakeUpstream = await listen(createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      captured = { method: req.method, url: req.url, body };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  }));

  const { createProxyServer } = await loadProxy(fakeUpstream.port);
  const proxy = createProxyServer();
  const bound = await listen(proxy);

  t.after(async () => {
    await close(bound.server);
    await close(fakeUpstream.server);
  });

  const payload = '{"hello":"world"}';
  const res = await httpReq(bound.port, {
    method: 'POST',
    path: '/v1/messages',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    body: payload,
  });
  assert.equal(res.status, 200);
  assert.equal(captured.method, 'POST');
  assert.equal(captured.url, '/v1/messages');
  assert.equal(captured.body, payload);
});

test('picker proxy forwards Bearer authorization header to upstream', async (t) => {
  let receivedAuth = null;
  const fakeUpstream = await listen(createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      receivedAuth = req.headers.authorization;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  }));

  const { createProxyServer } = await loadProxy(fakeUpstream.port);
  const proxy = createProxyServer();
  const bound = await listen(proxy);

  t.after(async () => {
    await close(bound.server);
    await close(fakeUpstream.server);
  });

  const res = await httpReq(bound.port, {
    method: 'POST',
    path: '/v1/messages',
    headers: { authorization: 'Bearer test-token' },
    body: '{}',
  });
  assert.equal(res.status, 200);
  assert.equal(receivedAuth, 'Bearer test-token');
});
