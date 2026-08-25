/** Minimal shell tokenizer plus Git global-option parser for hook guards. */

import { basename } from 'node:path';

const OPTIONS_WITH_VALUE = new Set([
  '-C', '-c',
  '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--attr-source',
]);
const FLAG_OPTIONS = new Set([
  '-v', '--version', '-h', '--help', '-p', '--paginate', '-P', '--no-pager',
  '--no-replace-objects', '--no-lazy-fetch', '--no-optional-locks', '--no-advice', '--bare',
  '--literal-pathspecs', '--glob-pathspecs', '--noglob-pathspecs', '--icase-pathspecs',
  '--html-path', '--man-path', '--info-path',
]);
const OPTIONS_WITH_OPTIONAL_EQUALS_VALUE = ['--exec-path', '--list-cmds'];

export function tokenizeShell(command) {
  const segments = [[]];
  let token = '';
  let quote = '';
  let escaped = false;
  const pushToken = () => {
    if (token) segments.at(-1).push(token);
    token = '';
  };
  const newSegment = () => {
    pushToken();
    if (segments.at(-1).length > 0) segments.push([]);
  };

  for (let index = 0; index < String(command || '').length; index++) {
    const char = command[index];
    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      else token += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      pushToken();
      if (char === '\n') newSegment();
      continue;
    }
    if (char === ';' || char === '|') {
      newSegment();
      if (command[index + 1] === char) index++;
      continue;
    }
    if (char === '&' && command[index + 1] === '&') {
      newSegment();
      index++;
      continue;
    }
    token += char;
  }
  if (escaped) token += '\\';
  pushToken();
  return segments.filter((segment) => segment.length > 0);
}

function isGitExecutable(token) {
  return basename(String(token || '')).toLowerCase() === 'git';
}

function skipGlobalOptions(tokens, start) {
  let index = start;
  while (index < tokens.length) {
    const token = tokens[index];
    if (OPTIONS_WITH_VALUE.has(token)) {
      if (index + 1 >= tokens.length) return tokens.length;
      index += 2;
      continue;
    }
    if ([...OPTIONS_WITH_VALUE].some((option) => token.startsWith(`${option}=`))) {
      index++;
      continue;
    }
    if (FLAG_OPTIONS.has(token) || OPTIONS_WITH_OPTIONAL_EQUALS_VALUE.some((option) => token === option || token.startsWith(`${option}=`))) {
      index++;
      continue;
    }
    // Git accepts documented short flags in compact form. Treat an otherwise
    // unknown leading option conservatively as a flag so a following commit,
    // push, or rebase action cannot evade a guard.
    if (/^-[A-Za-z]+$/.test(token) || /^--[A-Za-z][A-Za-z0-9-]*$/.test(token)) {
      index++;
      continue;
    }
    break;
  }
  return index;
}

export function parseGitCommands(command) {
  const parsed = [];
  for (const segment of tokenizeShell(command)) {
    for (let gitIndex = 0; gitIndex < segment.length; gitIndex++) {
      if (!isGitExecutable(segment[gitIndex])) continue;
      const commandIndex = skipGlobalOptions(segment, gitIndex + 1);
      const subcommand = segment[commandIndex];
      if (subcommand) {
        parsed.push({
          executable: segment[gitIndex],
          subcommand: subcommand.toLowerCase(),
          args: segment.slice(commandIndex + 1),
        });
      }
      break;
    }
  }
  return parsed;
}

export function findGitCommand(command, subcommand) {
  return parseGitCommands(command).find((entry) => entry.subcommand === subcommand) || null;
}
