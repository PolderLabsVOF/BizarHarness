/**
 * cli/commands/artifact.mjs
 *
 * Artifact command dispatcher — delegates to ../artifact-cli.mjs.
 * The actual implementation is split across:
 *   artifact-cli.mjs    — CLI dispatch + flag parsing + help
 *   artifact-server.mjs — HTTP server + routing
 *   artifact-render.mjs  — HTML rendering + canvas helpers + MDX export
 */
export { runArtifact, default } from '../artifact-cli.mjs';

export async function run(name, args, isHelpRequest) {
  if (isHelpRequest) {
    const { showHelp } = await import('../artifact-cli.mjs');
    showHelp();
    return;
  }
  const { runArtifact } = await import('../artifact-cli.mjs');
  await runArtifact(args, {});
}
