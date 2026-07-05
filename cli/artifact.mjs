/**
 * cli/artifact.mjs
 *
 * v4.6 — Re-export shell for the artifact module split.
 * All functionality moved to:
 *   artifact-cli.mjs    — CLI dispatch + flag parsing + help
 *   artifact-server.mjs — HTTP server + routing
 *   artifact-render.mjs — HTML rendering + canvas helpers + MDX export
 *
 * This file re-exports everything from the original API for backward
 * compatibility. New code should import directly from the split files.
 */
export {
  // From artifact-cli.mjs
  runArtifact as runPlan, // backward-compat alias (test imports runPlan)
  runArtifact,
  default,
  showHelp,
  regenerateHtml,
} from './artifact-cli.mjs';

export {
  // From artifact-server.mjs
  startServer,
} from './artifact-server.mjs';

export {
  // From artifact-render.mjs
  CANVAS_SCHEMA_VERSION,
  emptyCanvas,
  readCanvasFile,
  writeCanvasFile,
  loadOrMigrateCanvas,
  canvasToMarkdown,
  makeElementId,
  makeConnectionId,
  makeCommentId,
  makeReplyId,
  readPlanMeta,
  renderElementHTML,
  renderConnectionHTML,
  renderCommentPinHTML,
  renderCommentThreadHTML,
  renderReplyHTML,
  escapeHtml,
  formatDate,
  isHtmxRequest,
  decodeHtmxFormBody,
  elementTypeBadge,
  renderElementBody,
  renderCommentLi,
  renderCommentListHtml,
  renderCommentCountHtml,
  readRequestBody,
  bumpLastEdited,
  openBrowser,
  replaceTemplate,
  readTemplate,
  atomicWriteText,
  atomicWriteJson,
  writePlanFile,
  readPlanFile,
} from './artifact-render.mjs';
