import {
  enqueueControlMessage,
  getControlSnapshot,
  listControlAgents,
  listControlMessages,
  listControlSessions,
  listControlTasks,
  sendControlSessionMessage,
  startControlSession,
  stopControlSession,
} from '../control-store.mjs';

function parseFlags(args) {
  const flags = { _: [] };
  const values = new Set([
    '--agent', '--from', '--name', '--prompt', '--session',
    '--status', '--task', '--text',
  ]);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--json') flags.json = true;
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (values.has(arg) && index + 1 < args.length) {
      flags[arg.slice(2)] = args[++index];
    } else if (arg.startsWith('--') && arg.includes('=')) {
      const [name, ...rest] = arg.split('=');
      flags[name.slice(2)] = rest.join('=');
    } else {
      flags._.push(arg);
    }
  }
  return flags;
}

function print(value, flags) {
  if (flags.json) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function help() {
  process.stdout.write(`
  bizar control — machine-readable OpenKan/control-plane boundary

  Usage:
    bizar control snapshot --json
    bizar control agents|tasks|sessions|messages --json
    bizar control message --agent <agent>|--session <id> --text <text> [--from <sender>]
    bizar control session start --agent <agent> --prompt <text> [--name <name>]
    bizar control session send <id> --text <text> [--from <sender>]
    bizar control session stop <id>
` + "\n");
}

export async function run(name, args, isHelpRequest) {
  if (name !== 'control') return false;
  const flags = parseFlags(args);
  if (flags.help || isHelpRequest) {
    help();
    return true;
  }
  const [resource, action, id] = flags._;
  const root = process.cwd();
  try {
    if (resource === 'snapshot') print(getControlSnapshot(root), flags);
    else if (resource === 'agents') print({ agents: listControlAgents(root) }, flags);
    else if (resource === 'tasks') print(listControlTasks(root), flags);
    else if (resource === 'sessions') print({ sessions: listControlSessions(root) }, flags);
    else if (resource === 'messages') print(listControlMessages(root, { status: flags.status }), flags);
    else if (resource === 'message') {
      print(enqueueControlMessage(root, {
        from: flags.from,
        toAgent: flags.agent,
        toSession: flags.session,
        taskId: flags.task,
        text: flags.text,
      }), flags);
    } else if (resource === 'session' && action === 'start') {
      print(startControlSession(root, {
        agent: flags.agent,
        prompt: flags.prompt,
        name: flags.name,
      }), flags);
    } else if (resource === 'session' && action === 'send') {
      print(sendControlSessionMessage(root, id, {
        from: flags.from,
        taskId: flags.task,
        text: flags.text,
      }), flags);
    } else if (resource === 'session' && action === 'stop') {
      print(stopControlSession(root, id), flags);
    } else {
      help();
      process.exitCode = 2;
    }
  } catch (error) {
    const payload = { error: error.message || String(error) };
    if (flags.json) process.stderr.write(`${JSON.stringify(payload)}\n`);
    else console.error(`  ✗ ${payload.error}`);
    process.exitCode = 1;
  }
  return true;
}
