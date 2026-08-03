#!/usr/bin/env node
// 9router picker proxy — rewrites upstream model IDs to `claude-...` so
// Claude Code's /model picker surfaces them while preserving Anthropic defaults.
//
// ponytail: UPSTREAM host/port are constant because the picker proxy only ever
// fronts the local 9router gateway. If multi-gateway routing is ever needed,
// convert these to env-driven and re-test. BIZAR_PICKER_PROXY_TEST_* env vars
// exist only for the test harness.

import { createServer, request as httpRequest } from "node:http";

const UPSTREAM_HOST = process.env.BIZAR_PICKER_PROXY_TEST_UPSTREAM_HOST || "127.0.0.1";
const UPSTREAM_PORT = Number(process.env.BIZAR_PICKER_PROXY_TEST_UPSTREAM_PORT || 20128);
const LISTEN_HOST = process.env.BIZAR_PICKER_PROXY_TEST_LISTEN_HOST || "127.0.0.1";
const LISTEN_PORT = Number(process.env.BIZAR_PICKER_PROXY_TEST_LISTEN_PORT || process.env.BIZAR_PICKER_PROXY_PORT || 20129);

export function rewriteIds(parsed) {
  if (Array.isArray(parsed?.data)) {
    for (const m of parsed.data) {
      if (typeof m.id !== "string") continue;
      if (!m.id.startsWith("claude") && !m.id.startsWith("anthropic")) {
        m.id = `claude-${m.id}`;
      }
    }
  }
  return parsed;
}

function proxyUpstream(req, res) {
  const upstream = httpRequest({
    host: UPSTREAM_HOST,
    port: UPSTREAM_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `${UPSTREAM_HOST}:${UPSTREAM_PORT}` },
  });
  upstream.on("error", (e) => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`upstream error: ${e.message}`);
  });
  upstream.on("response", (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    upRes.pipe(res);
  });
  req.pipe(upstream);
}

function handleModels(req, res) {
  const upstream = httpRequest({
    host: UPSTREAM_HOST,
    port: UPSTREAM_PORT,
    path: "/v1/models?limit=1000",
    method: "GET",
    headers: { accept: "application/json" },
  });
  upstream.on("error", (e) => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`upstream error: ${e.message}`);
  });
  upstream.on("response", (upRes) => {
    let body = "";
    upRes.setEncoding("utf8");
    upRes.on("data", (c) => (body += c));
    upRes.on("end", () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(502, { "content-type": "text/plain" });
        res.end("upstream not JSON");
        return;
      }
      rewriteIds(parsed);
      const out = JSON.stringify(parsed);
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(out),
      });
      res.end(out);
    });
  });
  upstream.end();
}

export function createProxyServer() {
  return createServer((req, res) => {
    if (req.method === "GET" && req.url?.startsWith("/v1/models")) {
      handleModels(req, res);
      return;
    }
    proxyUpstream(req, res);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createProxyServer();
  server.listen(LISTEN_PORT, LISTEN_HOST, () => {
    process.stdout.write(`[picker-proxy] listening on http://${LISTEN_HOST}:${LISTEN_PORT} -> ${UPSTREAM_HOST}:${UPSTREAM_PORT}\n`);
  });
}
