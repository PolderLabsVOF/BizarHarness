#!/usr/bin/env node
/**
 * cli/graph-build-from-cache.mjs
 *
 * One-off script for environments where graphify's semantic-extraction
 * step fails (e.g. no LLM API key + remaining non-code docs that the
 * `.graphifyignore` can't filter) but the AST cache is intact.
 *
 * graphify's pipeline has two stages:
 *   1. AST extraction (local, tree-sitter) — writes per-file JSON to
 *      `.bizar/graph/cache/ast/v0.8.46/<hash>.json` regardless of LLM status.
 *   2. Semantic extraction (LLM, optional) — merges per-file nodes into a
 *      project-wide graph.
 *
 * If stage 2 aborts, `graph.json` is never written and the dashboard has
 * nothing to render. This script reconstructs `graph.json` directly from
 * the per-file AST cache, then calls `graphify cluster-only` to generate
 * `graph.html` + `GRAPH_REPORT.md`.
 *
 * Usage:
 *   node cli/graph-build-from-cache.mjs                 # use .bizar/graph/
 *   node cli/graph-build-from-cache.mjs /tmp/other/graph # custom dir
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const graphDirArg = process.argv[2] || '.bizar/graph';
const graphDir = resolve(graphDirArg);

// The cache version directory inside graphify's cache layout. Bumping the
// graphify version moves the cache; we discover the actual subdir at
// runtime so we don't hardcode "v0.8.46".
const cacheAstRoot = join(graphDir, 'cache', 'ast');

function findCacheDir() {
  if (!existsSync(cacheAstRoot)) {
    throw new Error(`No AST cache found at ${cacheAstRoot}. Run \`bizar graph build\` first to populate it.`);
  }
  const entries = readdirSync(cacheAstRoot);
  if (entries.length === 0) {
    throw new Error(`AST cache directory ${cacheAstRoot} is empty.`);
  }
  // graphify uses one version directory like v0.8.46. Pick the first.
  return join(cacheAstRoot, entries[0]);
}

function buildGraphFromCache(cacheDir) {
  const files = readdirSync(cacheDir).filter((f) => f.endsWith('.json'));
  console.log(`  Reading ${files.length} AST cache files from ${cacheDir}...`);

  const nodesById = new Map();
  const edges = [];
  const rawCalls = [];

  let fileIdx = 0;
  for (const f of files) {
    fileIdx++;
    const raw = JSON.parse(readFileSync(join(cacheDir, f), 'utf8'));
    for (const n of raw.nodes || []) {
      // Later files win on duplicate id (consistent with graphify's
      // dedup behavior — first write keeps the canonical location).
      if (!nodesById.has(n.id)) nodesById.set(n.id, n);
    }
    for (const e of raw.edges || []) edges.push(e);
    for (const rc of raw.raw_calls || []) rawCalls.push(rc);
    if (fileIdx % 50 === 0) {
      console.log(`    merged ${fileIdx}/${files.length} files`);
    }
  }

  // Re-key node.community so it matches the dashboard's expected schema.
  // The AST cache uses `community` as a numeric cluster id; we keep it as-is.
  const nodes = Array.from(nodesById.values());

  const graph = {
    directed: false,
    multigraph: false,
    graph: {},
    nodes,
    links: edges,
  };

  console.log(`  Built graph: ${nodes.length} nodes, ${edges.length} edges (raw_calls=${rawCalls.length})`);
  return { graph, rawCalls };
}

function writeOutputs(graphDir, graph) {
  // graph.json — NetworkX node-link format
  const graphJsonPath = join(graphDir, 'graph.json');
  writeFileSync(graphJsonPath, JSON.stringify(graph, null, 2), 'utf8');
  console.log(`  ✓ Wrote ${graphJsonPath}`);

  // .graphify_analysis.json — graphify's secondary output. cluster-only
  // doesn't strictly require this, but writing it keeps the directory
  // shape consistent with what `graphify .` would have produced.
  const analysis = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    clusters: [],
  };
  const analysisPath = join(graphDir, '.graphify_analysis.json');
  writeFileSync(analysisPath, JSON.stringify(analysis, null, 2), 'utf8');
  console.log(`  ✓ Wrote ${analysisPath}`);
}

function main() {
  console.log(`  Graph dir: ${graphDir}`);
  if (!existsSync(graphDir)) {
    throw new Error(`Graph dir does not exist: ${graphDir}`);
  }
  const cacheDir = findCacheDir();
  const { graph } = buildGraphFromCache(cacheDir);
  writeOutputs(graphDir, graph);
  console.log('');
  console.log('  Next step: run `bizar graph cluster-only` to generate graph.html.');
}

try {
  main();
} catch (err) {
  console.error(`\n  Error: ${err.message}\n`);
  process.exit(1);
}