/**
 * cli/__tests__/models-picker-tty.test.mjs
 *
 * TTY (keypress) branch coverage for `cli/commands/models.mjs#pickModels`.
 *
 * The line-mode picker is covered exhaustively by `models-picker.test.mjs`.
 * This suite verifies that when stdin is a TTY (`isTTY === true` and exposes
 * `setRawMode`), the picker switches to the arrow-key / space / enter
 * keypress loop and continues to:
 *
 *   - honour `enter` / `esc` as confirmations
 *   - type printable characters directly into fuzzy search
 *   - honour `space` as the row toggle under the cursor
 *   - honour named arrow keys as cursor movement
 *   - honour Ctrl+A / Ctrl+N for select-all / clear
 *   - honour `?` to toggle the help footer
 *   - scroll the viewport so the cursor row stays visible for 30+ candidates
 *   - decode raw escape sequences (`\x1b[A`, `\x1b[B`) when fed via `data`
 *
 * Mock strategy: `MockKeyStdin` is an EventEmitter that satisfies the
 * subset of `process.stdin` the picker touches (`isTTY`, `setRawMode`,
 * `setEncoding`, `resume`, `pause`, `on/off('keypress')`, and `on/off('data')`).
 *
 *   - Direct `keypress` emission drives most tests (synchronous, fast).
 *   - One test pushes raw escape sequences via `data` to cover the
 *     `readline.emitKeypressEvents` parser path.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';

import { pickModels } from '../commands/models.mjs';

function makeOutput() {
  let buf = '';
  const w = new Writable({
    write(chunk, _enc, cb) { buf += String(chunk); cb(); },
  });
  w.buffer = () => buf;
  // Mirror the subset of `process.stdout` the picker reads.
  Object.defineProperty(w, 'columns', { value: 120, configurable: true });
  return w;
}

/**
 * Minimal `process.stdin`-shaped mock. Does NOT subclass Readable because
 * the picker only needs an EventEmitter surface for `keypress` listening.
 */
function makeInteractiveStdin() {
  const ee = new EventEmitter();
  ee.isTTY = true;
  ee.setRawMode = () => { /* no-op — test simulates raw mode always on */ };
  ee.setEncoding = () => {};
  ee.resume = () => {};
  ee.pause = () => {};
  return ee;
}

function sendKey(ee, str, key) {
  ee.emit('keypress', str ?? null, key);
}

function sendReturn(ee) {
  sendKey(ee, '\r', { name: 'return' });
}

function sendSpace(ee) {
  sendKey(ee, ' ', { name: 'space' });
}

function sendDown(ee) {
  sendKey(ee, null, { name: 'down' });
}

function sendUp(ee) {
  sendKey(ee, null, { name: 'up' });
}

async function settle() {
  // Drain pending microtasks so the picker has wired its keypress listener.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

async function runPicker({ candidates, current = [], input, columns = 120 }) {
  const stdin = makeInteractiveStdin();
  const stdout = makeOutput();
  Object.defineProperty(stdout, 'columns', { value: columns, configurable: true });
  const promise = pickModels({ candidates, current, stdin, stdout, prompt: 'Pick models' });
  // give the picker a tick to install its keypress listener and paint the
  // initial frame
  await settle();
  if (typeof input === 'function') input(stdin);
  return { result: await promise, stdout };
}

test('pickModelsInteractive: enter on empty selection returns current picks', async () => {
  const candidates = [
    { id: 'a/1' }, { id: 'b/2' }, { id: 'c/3' },
  ];
  const { result } = await runPicker({
    candidates,
    current: ['b/2'],
    input: (stdin) => sendReturn(stdin),
  });
  assert.deepEqual(result, ['b/2']);
});

test('pickModelsInteractive: arrow-down moves cursor, space toggles that row', async () => {
  const candidates = [
    { id: 'a/1' }, { id: 'b/2' }, { id: 'c/3' }, { id: 'd/4' },
  ];
  const { result } = await runPicker({
    candidates,
    current: [],
    input: (stdin) => {
      // Cursor starts on row 0 (a/1). Two downs lands on c/3. Space toggles.
      sendDown(stdin); sendDown(stdin);
      sendSpace(stdin);
      sendReturn(stdin);
    },
  });
  assert.deepEqual(result, ['c/3']);
});

test('pickModelsInteractive: arrow-down then space then arrow-up then space toggles off', async () => {
  const candidates = [
    { id: 'a/1' }, { id: 'b/2' }, { id: 'c/3' }, { id: 'd/4' },
  ];
  const { result } = await runPicker({
    candidates,
    current: [],
    input: (stdin) => {
      sendDown(stdin); sendDown(stdin); // cursor on c/3
      sendSpace(stdin);                  // toggle on
      sendUp(stdin);                     // cursor on b/2
      sendUp(stdin);                     // cursor on a/1
      sendUp(stdin);                     // wrap to d/4
      sendUp(stdin);                     // wrap to c/3
      sendSpace(stdin);                  // toggle c/3 OFF
      sendReturn(stdin);
    },
  });
  assert.deepEqual(result, []);
});

test('pickModelsInteractive: direct typing fuzzy-filters by profile name', async () => {
  const candidates = [
    { id: 'a/1', profile: { name: 'Alpha' } },
    { id: 'b/2', profile: { name: 'Beta' } },
    { id: 'c/3', profile: { name: 'Code Luna' } },
  ];
  const { result, stdout } = await runPicker({
    candidates,
    current: [],
    input: (stdin) => {
      for (const char of 'luna') sendKey(stdin, char, { name: char });
      sendSpace(stdin);
      sendReturn(stdin);
    },
  });
  assert.deepEqual(result, ['c/3']);
  assert.match(stdout.buffer(), /Search: luna/);
  assert.match(stdout.buffer(), /1\/3 shown/);
});

test('pickModelsInteractive: Ctrl+A selects every row in original order', async () => {
  const candidates = [
    { id: 'a/1' }, { id: 'b/2' }, { id: 'c/3' }, { id: 'd/4' },
  ];
  const { result } = await runPicker({
    candidates,
    current: [],
    input: (stdin) => {
      sendKey(stdin, '\x01', { name: 'a', ctrl: true });
      sendReturn(stdin);
    },
  });
  assert.deepEqual(result, ['a/1', 'b/2', 'c/3', 'd/4']);
});

test('pickModelsInteractive: Ctrl+N clears every selection', async () => {
  const candidates = [
    { id: 'a/1' }, { id: 'b/2' }, { id: 'c/3' },
  ];
  const { result } = await runPicker({
    candidates,
    current: ['a/1', 'b/2'],
    input: (stdin) => {
      sendKey(stdin, '\x0e', { name: 'n', ctrl: true });
      sendReturn(stdin);
    },
  });
  assert.deepEqual(result, []);
});

test('pickModelsInteractive: printable q searches instead of exiting', async () => {
  const candidates = [
    { id: 'a/1' }, { id: 'qwen/qwen-3' }, { id: 'c/3' },
  ];
  const { result, stdout } = await runPicker({
    candidates,
    current: [],
    input: (stdin) => {
      sendKey(stdin, 'q', { name: 'q' });
      sendSpace(stdin);
      sendReturn(stdin);
    },
  });
  assert.deepEqual(result, ['qwen/qwen-3']);
  assert.match(stdout.buffer(), /Search: q/);
});

test('pickModelsInteractive: ESC alone (name="escape") confirms and returns picks', async () => {
  const candidates = [
    { id: 'a/1' }, { id: 'b/2' },
  ];
  const { result } = await runPicker({
    candidates,
    current: ['b/2'],
    input: (stdin) => {
      sendKey(stdin, '\x1b', { name: 'escape', code: '\x1b' });
    },
  });
  assert.deepEqual(result, ['b/2']);
});

test('pickModelsInteractive: "?" toggles the help footer line', async () => {
  const candidates = [{ id: 'a/1' }];
  const { result, stdout } = await runPicker({
    candidates,
    current: [],
    input: (stdin) => {
      // Without help footer, the rendered block does not include the
      // "Extra:" footer. After `?`, it does.
      sendKey(stdin, '?', { name: '?' });
      sendReturn(stdin);
    },
  });
  assert.deepEqual(result, []);
  // The help footer phrase is unique enough to assert without coupling to
  // exact chalk escape sequences.
  assert.match(stdout.buffer(), /Extra: type to search · backspace edit · esc clear\/confirm · ctrl\+a all · ctrl\+n none · \? help\./);
});

test('pickModelsInteractive: backspace edits and escape clears an active query before confirming', async () => {
  const candidates = [
    { id: 'openai/luna', profile: { name: 'Luna' } },
    { id: 'minimax/m3', profile: { name: 'MiniMax' } },
  ];
  const { result, stdout } = await runPicker({
    candidates,
    current: ['minimax/m3'],
    input: (stdin) => {
      for (const char of 'lunax') sendKey(stdin, char, { name: char });
      sendKey(stdin, '\x7f', { name: 'backspace' });
      sendKey(stdin, '\x1b', { name: 'escape', code: '\x1b' });
      sendSpace(stdin); // after clear, cursor is safely back on openai/luna
      sendReturn(stdin);
    },
  });
  assert.deepEqual(result, ['minimax/m3', 'openai/luna'], 'selection hidden by search remains selected');
  assert.match(stdout.buffer(), /Search: lunax/);
  assert.match(stdout.buffer(), /Search: luna/);
  assert.match(stdout.buffer(), /Search: type a model name or ID/);
});

test('pickModelsInteractive: no-match arrow and space input are safe', async () => {
  const candidates = [{ id: 'openai/luna' }, { id: 'minimax/m3' }];
  const { result, stdout } = await runPicker({
    candidates,
    current: ['minimax/m3'],
    input: (stdin) => {
      for (const char of 'zzzz') sendKey(stdin, char, { name: char });
      sendDown(stdin);
      sendUp(stdin);
      sendSpace(stdin);
      sendReturn(stdin);
    },
  });
  assert.deepEqual(result, ['minimax/m3']);
  assert.match(stdout.buffer(), /No models match your search/);
  assert.match(stdout.buffer(), /0\/2 shown/);
});

test('pickModelsInteractive: viewport stays bounded when 30 candidates are scrolled', async () => {
  // 30 candidates forces viewport scrolling (VIEWPORT_SIZE=20). Drive the
  // cursor past the bottom and assert only the 20 visible rows are ever
  // rendered after the cursor stops at row 25.
  const candidates = Array.from({ length: 30 }, (_, i) => ({ id: `model/${String(i + 1).padStart(2, '0')}` }));
  const { result, stdout } = await runPicker({
    candidates,
    current: [],
    input: (stdin) => {
      // Start on row 0. Walk to row 25 — past the initial 20-row viewport.
      for (let i = 0; i < 25; i++) sendDown(stdin);
      sendSpace(stdin);
      sendReturn(stdin);
    },
    columns: 80,
  });
  assert.deepEqual(result, ['model/26']);
  const buf = stdout.buffer();
  // The full list of 30 ids must NEVER appear inside the rendered viewport:
  // rows outside the [scrollTop, scrollTop+20) window are hidden behind
  // "⋮ N more above" / "⋮ N more below" indicators.
  for (let i = 1; i <= 5; i++) {
    assert.doesNotMatch(buf, new RegExp(`(?:^|\\n)\\s+\\| \\[.{1}\\]\\s+\\d+\\.\\s+model/${String(i).padStart(2, '0')}\\b`), `row ${i} should be hidden above viewport after scrolling to row 25`);
  }
  // The picked row (model/26) must be visible.
  assert.match(buf, /model\/26/);
  // Scrolling indicator shown at least once ("⋮ N more above" or "below").
  assert.match(buf, /⋮\s+\d+\s+more (above|below)/);
});

test('pickModelsInteractive: arrow-up at row 0 wraps to the last row', async () => {
  const candidates = [
    { id: 'a/1' }, { id: 'b/2' }, { id: 'c/3' },
  ];
  const { result } = await runPicker({
    candidates,
    current: [],
    input: (stdin) => {
      sendUp(stdin);   // wrap: a/1 → c/3
      sendSpace(stdin); // toggle c/3
      sendReturn(stdin);
    },
  });
  assert.deepEqual(result, ['c/3']);
});

test('pickModelsInteractive: arrow-down at last row wraps to row 0', async () => {
  const candidates = [
    { id: 'a/1' }, { id: 'b/2' }, { id: 'c/3' },
  ];
  const { result } = await runPicker({
    candidates,
    current: [],
    input: (stdin) => {
      sendDown(stdin); sendDown(stdin); // cursor on c/3
      sendDown(stdin);                  // wrap: c/3 → a/1
      sendSpace(stdin);
      sendReturn(stdin);
    },
  });
  assert.deepEqual(result, ['a/1']);
});

test('pickModelsInteractive: raw escape sequences via data are decoded by emitKeypressEvents', async () => {
  // Verify the picker decodes \x1b[A / \x1b[B correctly when fed as raw
  // bytes via 'data' (i.e. through the real readline parser).
  const candidates = [
    { id: 'a/1' }, { id: 'b/2' }, { id: 'c/3' }, { id: 'd/4' },
  ];
  const stdin = makeInteractiveStdin();
  const stdout = makeOutput();
  Object.defineProperty(stdout, 'columns', { value: 120, configurable: true });

  const promise = pickModels({ candidates, current: [], stdin, stdout });
  await settle();
  // Cursor on row 0 (a/1). Two "\x1b[B" -> row 2 (c/3). One "\r" -> confirm.
  stdin.emit('data', '\x1b[B');
  stdin.emit('data', '\x1b[B');
  stdin.emit('data', '\r');
  const result = await promise;
  assert.deepEqual(result, []);
  // Verify the picks fired: drive down once more, then space, then CR.
  const stdin2 = makeInteractiveStdin();
  const stdout2 = makeOutput();
  Object.defineProperty(stdout2, 'columns', { value: 120, configurable: true });
  const promise2 = pickModels({ candidates, current: [], stdin: stdin2, stdout: stdout2 });
  await settle();
  stdin2.emit('data', '\x1b[B'); // a/1 → b/2
  stdin2.emit('data', '\x1b[B'); // b/2 → c/3
  stdin2.emit('data', ' ');       // toggle c/3
  stdin2.emit('data', '\r');      // confirm
  const result2 = await promise2;
  assert.deepEqual(result2, ['c/3']);
});

test('pickModelsInteractive: ctrl+c discards selection and exits', async () => {
  const candidates = [
    { id: 'a/1' }, { id: 'b/2' }, { id: 'c/3' },
  ];
  const { result, stdout } = await runPicker({
    candidates,
    current: ['b/2'],
    input: (stdin) => {
      sendDown(stdin);
      sendSpace(stdin); // toggle c/3 ON
      sendKey(stdin, '\x03', { name: 'c', ctrl: true });
    },
  });
  assert.deepEqual(result, []);
  // SHOW_CURSOR must be written so the terminal isn't left in a broken state.
  assert.match(stdout.buffer(), /\x1b\[\?25h/);
});

test('pickModelsInteractive: shows both indicators when cursor sits mid-viewport after scroll', async () => {
  // With 30 candidates and a 20-row viewport, scrolling kicks in only after
  // the cursor crosses row 19. Walk down 25 rows (cursor → row 25,
  // scrollTop → 6), then walk up 20 rows (cursor → row 5, scrollTop clamps
  // to 5). The viewport is [5, 25), so both `⋮ 5 more above` and
  // `⋮ 5 more below` must be emitted.
  const candidates = Array.from({ length: 30 }, (_, i) => ({ id: `m/${i}` }));
  const { result, stdout } = await runPicker({
    candidates,
    current: [],
    input: (stdin) => {
      for (let i = 0; i < 25; i++) sendDown(stdin);
      for (let i = 0; i < 20; i++) sendUp(stdin);
      sendReturn(stdin);
    },
  });
  assert.deepEqual(result, []);
  const buf = stdout.buffer();
  assert.match(buf, /⋮\s+\d+\s+more above/);
  assert.match(buf, /⋮\s+\d+\s+more below/);
});

test('pickModelsInteractive: setRawMode throwing falls back to line-mode', async () => {
  // If raw mode cannot be enabled (e.g. redirected TTY), the picker must
  // still answer — via the line-mode path that the existing
  // models-picker.test.mjs suite already exercises.
  const candidates = [{ id: 'a/1' }, { id: 'b/2' }, { id: 'c/3' }];
  const stdin = makeInteractiveStdin();
  stdin.setRawMode = () => { throw new Error('raw mode unavailable'); };
  const stdout = makeOutput();
  Object.defineProperty(stdout, 'columns', { value: 120, configurable: true });

  // Drive the fallback path through `pickModels`'s own line-mode picker.
  // It expects stdin to emit line-buffered data ending in a newline.
  const promise = pickModels({ candidates, current: [], stdin, stdout });
  await settle();
  // "1 3\n" picks row 1 (a/1) and row 3 (c/3), then Enter confirms on empty line.
  stdin.emit('data', '1 3\n');
  stdin.emit('data', '\n');
  const result = await promise;
  assert.deepEqual(result, ['a/1', 'c/3']);
});
