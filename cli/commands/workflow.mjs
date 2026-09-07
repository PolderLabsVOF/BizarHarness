import chalk from 'chalk';

import {
  WORKFLOW_PROFILES,
  WorkflowStateError,
  advanceWorkflow,
  cancelWorkflow,
  failWorkflow,
  getWorkflowState,
  resumeWorkflow,
  startWorkflow,
} from '../core/workflow-state.mjs';

const DEFAULT_PROBE_TIMEOUT_MS = 3_000;

function normalizeEndpoint(value) {
  if (typeof value !== 'string' || value === '' || value.trim() !== value) return null;
  const normalized = value.replace(/\/+$/, '');
  return normalized || null;
}

function requireEffectiveInferenceEndpoint(env = process.env) {
  const inferenceEndpoint = normalizeEndpoint(env.ANTHROPIC_BASE_URL);
  if (!inferenceEndpoint) {
    throw new WorkflowStateError(
      'INFERENCE_ENDPOINT_REQUIRED',
      'workflow start requires ANTHROPIC_BASE_URL to point at the inference gateway',
    );
  }
  return inferenceEndpoint;
}

function parseFlags(args) {
  const flags = { _: [] };
  const values = new Set([
    '--profile', '--workflow', '--mode', '--project', '--session', '--session-id',
    '--run', '--run-id', '--revision', '--expected-revision', '--stage', '--expected-stage',
    '--reason', '--goal', '--evidence',
  ]);
  // Boolean flags take no value. Long flags use the kebab->camel key;
  // short flags carry an explicit key mapping.
  const booleans = new Set(['--json', '--help', '--deliberate', '--advisory']);
  const shortBooleans = new Map([['-h', 'help']]);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (booleans.has(arg)) {
      flags[arg.slice(2).replaceAll('-', '')] = true;
    } else if (shortBooleans.has(arg)) {
      flags[shortBooleans.get(arg)] = true;
    } else if (values.has(arg)) {
      if (index + 1 >= args.length) throw new WorkflowStateError('USAGE', `${arg} requires a value`);
      flags[arg.slice(2).replaceAll('-', '')] = args[++index];
    } else if (arg.startsWith('--') && arg.includes('=')) {
      const [name, ...rest] = arg.split('=');
      if (!values.has(name)) throw new WorkflowStateError('USAGE', `unknown option: ${name}`);
      flags[name.slice(2).replaceAll('-', '')] = rest.join('=');
    } else if (arg.startsWith('-')) {
      throw new WorkflowStateError('USAGE', `unknown option: ${arg}`);
    } else {
      flags._.push(arg);
    }
  }
  return flags;
}

function showHelp() {
  console.log(`
  bizar workflow — session-bound autopilot workflow state

  Usage:
    bizar workflow start --goal <text> [--profile default|plan-build-qa] [--session <id>]
    bizar workflow start --mode ralplan [--deliberate] [--advisory] --goal <text>
    bizar workflow status [--session <id>]
    bizar workflow resume [--session <id>]
    bizar workflow advance --run <uuid> --revision <n> --stage <stage> --evidence <text>
    bizar workflow fail --run <uuid> --revision <n> --stage <stage> --reason <text>
    bizar workflow cancel --run <uuid> --revision <n> --stage <stage> [--reason <text>]

  Common flags:
    --project <path>    Project root (defaults to the current directory)
    --session <id>      Claude session id (defaults to CLAUDE_SESSION_ID)
    --mode <name>       Routing hint for start (ralplan routes to the 8-step consensus protocol)
    --deliberate        Force the pre-mortem round on a ralplan-shaped workflow
    --advisory          Run the protocol without enforced gates (observability only)
    --json              Emit machine-readable JSON

  Profiles:
    ${Object.keys(WORKFLOW_PROFILES).join(' | ')}
    --workflow is accepted as an alias for --profile on start.
    --mode ralplan is accepted on start and routes to plan-shaped execution;
    it does not alter the persisted profile (the skill layer consumes the hint).

  Mutations require the expected run, revision, and stage. This prevents stale
  agents from advancing or terminating a newer workflow state.
`);
}

function context(flags) {
  return {
    projectRoot: flags.project || process.cwd(),
    sessionId: flags.session || flags.sessionid || process.env.CLAUDE_SESSION_ID || process.env.BIZAR_SESSION_ID,
  };
}

function expected(flags) {
  const rawRevision = flags.expectedrevision || flags.revision;
  const revision = rawRevision === undefined ? undefined : Number(rawRevision);
  return {
    runId: flags.runid || flags.run,
    revision,
    stage: flags.expectedstage || flags.stage,
  };
}

function printState(state, flags) {
  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, workflow: state }, null, 2)}\n`);
    return;
  }
  console.log(chalk.green(`  ✓ ${state.mode} ${state.status}: ${state.stage} (revision ${state.revision})`));
  console.log(chalk.dim(`    run ${state.runId}`));
}

/**
 * Resolve the routing hint from the new --mode / --deliberate / --advisory
 * flags. Pure: takes a flags object and returns a routing decision without
 * mutating any external state.
 *
 * The bizplan-shaped 8-step protocol is engaged when the user passes
 * `--mode bizplan` (or its legacy alias `ralplan`). The workflow state
 * still uses an underlying WORKFLOW_PROFILES entry; we map `bizplan` to
 * `plan-build-qa` because that profile is the closest existing plan-led
 * shape. The deliberate and advisory flags are pure hints that
 * downstream skill / agent consumers read from the returned routing
 * object.
 *
 * @param {Record<string, unknown>} flags — parsed flags from parseFlags()
 * @returns {{ profile: string, deliberate: boolean, advisory: boolean,
 *             routing: { mode: string|null, deliberate: boolean,
 *                        advisory: boolean } }}
 */
export function resolveStartRouting(flags) {
  const rawMode = typeof flags.mode === 'string' && flags.mode !== '' ? flags.mode : null;
  // Legacy `ralplan` is accepted as a deprecated alias for `bizplan` so
  // existing operators do not break; the canonical name is `bizplan`.
  const mode = rawMode === 'ralplan' ? 'bizplan' : rawMode;
  if (mode !== null && mode !== 'bizplan') {
    throw new WorkflowStateError(
      'USAGE',
      `unknown --mode value: ${rawMode} (expected: bizplan)`,
    );
  }
  const deliberate = flags.deliberate === true;
  const advisory = flags.advisory === true;

  if (mode === 'bizplan') {
    // bizplan routes through the existing plan-build-qa profile — the
    // closest WORKFLOW_PROFILES entry to the 8-step shape — without
    // modifying workflow-state.mjs's frozen profile table.
    return {
      profile: 'plan-build-qa',
      deliberate,
      advisory,
      routing: { mode, deliberate, advisory },
    };
  }
  const explicitProfile = typeof flags.profile === 'string' && flags.profile !== ''
    ? flags.profile
    : (typeof flags.workflow === 'string' && flags.workflow !== '' ? flags.workflow : 'default');
  return {
    profile: explicitProfile,
    deliberate,
    advisory,
    routing: { mode: null, deliberate, advisory },
  };
}

export async function run(name, args, isHelpRequest) {
  if (name !== 'workflow') return false;
  let flags;
  try {
    flags = parseFlags(args);
    if (flags.help || isHelpRequest) {
      showHelp();
      return true;
    }
    const [subcommand] = flags._;
    if (!subcommand) {
      showHelp();
      return true;
    }

    let state;
    const ctx = context(flags);
    if (subcommand === 'start') {
      if (flags.profile && flags.workflow && flags.profile !== flags.workflow) {
        throw new WorkflowStateError(
          'USAGE',
          '--profile and --workflow cannot specify different profiles',
        );
      }
      const routing = resolveStartRouting(flags);
      if (routing.routing.mode !== null && (flags.profile || flags.workflow)) {
        throw new WorkflowStateError(
          'USAGE',
          '--mode cannot be combined with --profile or --workflow; --mode owns the routing hint',
        );
      }
      // The picker/router is gone; workflows no longer probe a model list
      // or load a model-router registry. Native Claude Code resolves the
      // alias via the four ANTHROPIC_DEFAULT_*_MODEL env vars shipped in
      // config/claude/settings.json. We still require ANTHROPIC_BASE_URL
      // so an operator without a gateway cannot silently inherit a
      // provider default.
      try {
        requireEffectiveInferenceEndpoint();
      } catch (error) {
        if (!(error instanceof WorkflowStateError)) throw error;
        throw error;
      }
      state = startWorkflow({
        ...ctx,
        profile: routing.profile,
        goal: flags.goal,
      });
      if (routing.routing.mode !== null && !flags.json) {
        // Surface the routing hint in human mode. In JSON mode the
        // routing is implicit in the persisted profile (ralplan → plan-build-qa)
        // and downstream consumers read it via `bizar workflow status --json`.
        console.log(chalk.cyan(`    routing: ${routing.routing.mode}`));
        if (routing.routing.deliberate) console.log(chalk.cyan('    deliberate: pre-mortem round enabled'));
        if (routing.routing.advisory) console.log(chalk.cyan('    advisory: gates not enforced (observability only)'));
      }
    } else if (subcommand === 'status') {
      state = getWorkflowState(ctx);
    } else if (subcommand === 'resume') {
      state = resumeWorkflow(ctx);
    } else if (subcommand === 'advance') {
      state = advanceWorkflow({ ...ctx, expected: expected(flags), evidence: flags.evidence });
    } else if (subcommand === 'fail') {
      state = failWorkflow({ ...ctx, expected: expected(flags), reason: flags.reason });
    } else if (subcommand === 'cancel') {
      state = cancelWorkflow({ ...ctx, expected: expected(flags), reason: flags.reason });
    } else {
      throw new WorkflowStateError('USAGE', `unknown workflow subcommand: ${subcommand}`);
    }
    printState(state, flags);
    return true;
  } catch (error) {
    const code = error instanceof WorkflowStateError
      ? error.code
      : typeof error?.code === 'string'
        ? error.code
        : 'WORKFLOW_ERROR';
    const payload = { ok: false, error: { code, message: error.message || String(error) } };
    if (error?.details !== undefined) payload.error.details = error.details;
    if (flags?.json || args.includes('--json')) {
      process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      console.error(chalk.red(`  ✗ ${code}: ${payload.error.message}`));
    }
    process.exitCode = code === 'USAGE' || code.endsWith('_REQUIRED') || code.startsWith('INVALID_') ? 2 : 1;
    return true;
  }
}
