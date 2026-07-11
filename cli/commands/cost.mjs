/**
 * cli/commands/cost.mjs
 *
 * F-035 (MetaHarness) — `bizar cost` subcommand surface.
 *
 * Subcommands:
 *   bizar cost register <room> <cap>     # registerRoom(roomId, capUsd)
 *   bizar cost status   <room>           # status(roomId) → JSON
 *   bizar cost status   [--all]          # listRooms()
 *   bizar cost reserve  <room> <amount>  # reserve(roomId, callerId, amount)
 *     --caller <id>                     (default: process.env.USER)
 *     --expiry <ms>                     (default: 60_000, clamped to [5s, 300s])
 *   bizar cost commit   <txId> <amount>  # commit(txId, actualUsd)
 *   bizar cost release  <txId>           # release(txId)
 *   bizar cost sweep                      # sweepExpired() (manual)
 *
 * Wraps cli/cost-gate.mjs (better-sqlite3-backed, atomic).
 *
 * --json flag for machine-readable output.
 */

import chalk from 'chalk';
import { existsSync } from 'node:fs';

import { CostGate, defaultDbPath } from '../cost-gate.mjs';

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_USAGE = 2;

function parseFlags(args) {
  const flags = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') flags.json = true;
    else if (a === '--all') flags.all = true;
    else if (a === '--caller' && i + 1 < args.length) { flags.caller = args[++i]; }
    else if (a.startsWith('--caller=')) flags.caller = a.slice('--caller='.length);
    else if (a === '--expiry' && i + 1 < args.length) { flags.expiry = Number(args[++i]); }
    else if (a.startsWith('--expiry=')) flags.expiry = Number(a.slice('--expiry='.length));
    else if (a === '--db' && i + 1 < args.length) { flags.db = args[++i]; }
    else if (a.startsWith('--db=')) flags.db = a.slice('--db='.length);
    else if (a === '--help' || a === '-h') flags.help = true;
    else flags._.push(a);
  }
  return flags;
}

function showHelp() {
  console.log(`
  bizar cost — atomic cost gate (SQLite-backed room budget tracker)

  Usage:
    bizar cost register <room> <cap>            Register a room with a monthly cap (USD)
    bizar cost status   [room] [--all]          Show one room's status, or list all rooms
    bizar cost reserve  <room> <amount>         Reserve budget (atomic; returns txId)
      [--caller <id>]                           Caller id (default: $USER)
      [--expiry <ms>]                           Reservation window (default 60000, range [5s,300s])
    bizar cost commit   <txId> <amount>         Commit the actual cost
    bizar cost release  <txId>                  Release a still-reserved reservation
    bizar cost sweep                            Sweep expired reservations (--expired)
    bizar cost list                              List all transactions in a room (requires <room>)

  Flags:
    --json            Machine-readable JSON output
    --db <path>       Override DB path (default: ~/.bizar/cost-gate.db)
    --all             For \`status\`: list every room
    --caller <id>     Reservation caller id
    --expiry <ms>     Reservation window before expiry
    --help, -h        Show this help

  Description:
    The cost gate prevents overspend on multi-model orchestration by
    atomically reserving / committing / releasing micro-budget lines
    per request. Uses better-sqlite3 with WAL + BEGIN IMMEDIATE so
    concurrent reserves never double-spend.

  Examples:
    bizar cost register titan-cluster 50
    bizar cost reserve titan-cluster 1.50 --caller sonnet --expiry 30000
    bizar cost commit   tx-7a4b... 0.42
`);
}

function withGate(flags, fn) {
  const gate = new CostGate({ dbPath: flags.db || defaultDbPath() });
  try {
    return fn(gate);
  } finally {
    gate.close();
  }
}

function out(result, flags, formatter) {
  if (flags.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else if (formatter) {
    formatter(result);
  } else if (typeof result === 'string') {
    console.log(result);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

export async function run(name, args, isHelpRequest) {
  if (name !== 'cost') return false;
  const flags = parseFlags(args);
  if (flags.help || isHelpRequest) {
    showHelp();
    return true;
  }

  const [sub, ...rest] = flags._;
  if (!sub) {
    showHelp();
    return true;
  }

  try {
    if (sub === 'register') {
      const [room, capStr] = rest;
      if (!room || capStr == null) {
        console.error(chalk.red('  ✗ Usage: bizar cost register <room> <cap>'));
        return false;
      }
      const cap = Number(capStr);
      if (!Number.isFinite(cap) || cap < 0) {
        console.error(chalk.red('  ✗ cap must be a non-negative number'));
        return false;
      }
      const result = withGate(flags, (gate) => gate.registerRoom(room, cap));
      out(result, flags, (r) =>
        console.log(chalk.green(`  ✓ Registered room '${r.roomId}' with cap $${r.capUsd.toFixed(2)}`)),
      );
      return true;
    }

    if (sub === 'status') {
      const [room] = rest;
      const result = withGate(flags, (gate) => {
        if (flags.all || !room) return { rooms: gate.listRooms() };
        return gate.status(room);
      });
      out(result, flags, (r) => {
        if (r.rooms) {
          console.log(chalk.bold(`  Rooms (${r.rooms.length}):`));
          for (const rm of r.rooms) {
            console.log(`    ${chalk.cyan(rm.roomId)} cap=$${rm.capUsd.toFixed(2)} spent=$${rm.spentUsd.toFixed(2)} reserved=$${rm.reservedUsd.toFixed(2)} remaining=$${rm.remainingUsd.toFixed(2)}`);
          }
          return;
        }
        if (r === null) {
          console.log(chalk.yellow(`  ! Room '${room}' not found`));
          return;
        }
        console.log(chalk.bold(`  Room ${chalk.cyan(r.roomId)}:`));
        console.log(`    cap      = $${r.capUsd.toFixed(2)}`);
        console.log(`    spent    = $${r.spentUsd.toFixed(2)}`);
        console.log(`    reserved = $${r.reservedUsd.toFixed(2)}`);
        console.log(`    remaining= $${r.remainingUsd.toFixed(2)}`);
        console.log(`    txCount  = ${r.txCount}`);
      });
      return true;
    }

    if (sub === 'reserve') {
      const [room, amountStr] = rest;
      if (!room || amountStr == null) {
        console.error(chalk.red('  ✗ Usage: bizar cost reserve <room> <amount> [--caller <id>] [--expiry <ms>]'));
        return false;
      }
      const amount = Number(amountStr);
      if (!Number.isFinite(amount) || amount < 0) {
        console.error(chalk.red('  ✗ amount must be a non-negative number'));
        return false;
      }
      const caller = flags.caller || process.env.USER || 'unknown';
      const opts = {};
      if (flags.expiry != null) opts.expiryMs = flags.expiry;
      const result = withGate(flags, (gate) => gate.reserve(room, caller, amount, opts));
      if (!result.ok) {
        if (flags.json) {
          process.stdout.write(JSON.stringify(result) + '\n');
        } else {
          console.log(chalk.red(`  ✗ Reserve failed: ${result.error}`));
          if (result.error === 'BUDGET_EXCEEDED') {
            console.log(chalk.dim(`     cap=$${result.capUsd.toFixed(2)} committed=$${result.committed.toFixed(2)} reserved=$${result.reserved.toFixed(2)}`));
          }
        }
        return true; // graceful failure with status to caller
      }
      out(result, flags, (r) =>
        console.log(
          chalk.green(`  ✓ Reserved $${amount.toFixed(2)} in '${room}' → ${chalk.bold(r.txId)} (expires in ${Math.round((r.expiresAt - Date.now()) / 1000)}s, remaining=$${r.remainingAfterReserve.toFixed(2)})`),
        ),
      );
      return true;
    }

    if (sub === 'commit') {
      const [txId, amountStr] = rest;
      if (!txId || amountStr == null) {
        console.error(chalk.red('  ✗ Usage: bizar cost commit <txId> <amount>'));
        return false;
      }
      const amount = Number(amountStr);
      if (!Number.isFinite(amount) || amount < 0) {
        console.error(chalk.red('  ✗ amount must be a non-negative number'));
        return false;
      }
      const result = withGate(flags, (gate) => gate.commit(txId, amount));
      out(result, flags, (r) => {
        if (!r.ok) {
          console.log(chalk.red(`  ✗ Commit failed: ${r.error}`));
          return;
        }
        if (r.warned === 'COMMIT_AFTER_EXPIRY') {
          console.log(chalk.yellow(`  ⚠ Committed ${txId} after expiry ($${amount.toFixed(2)}); remaining=$${r.finalRemaining.toFixed(2)}`));
        } else {
          console.log(chalk.green(`  ✓ Committed ${txId} ($${amount.toFixed(2)}); remaining=$${r.finalRemaining.toFixed(2)}`));
        }
      });
      return true;
    }

    if (sub === 'release') {
      const [txId] = rest;
      if (!txId) {
        console.error(chalk.red('  ✗ Usage: bizar cost release <txId>'));
        return false;
      }
      const result = withGate(flags, (gate) => gate.release(txId));
      out(result, flags, (r) => {
        if (!r.ok) {
          console.log(chalk.red(`  ✗ Release failed: ${r.error}`));
          return;
        }
        console.log(chalk.green(`  ✓ Released ${txId}`));
      });
      return true;
    }

    if (sub === 'sweep') {
      const result = withGate(flags, (gate) => ({ swept: gate.sweepExpired() }));
      out(result, flags, (r) =>
        console.log(chalk.green(`  ✓ Swept ${r.swept} expired reservation(s)`)),
      );
      return true;
    }

    if (sub === 'list') {
      const [room] = rest;
      if (!room) {
        console.error(chalk.red('  ✗ Usage: bizar cost list <room>'));
        return false;
      }
      const result = withGate(flags, (gate) => ({ room, txs: gate.listTransactions(room) }));
      out(result, flags, (r) => {
        if (r.txs.length === 0) {
          console.log(chalk.dim(`  (no transactions in ${r.room})`));
          return;
        }
        console.log(chalk.bold(`  Transactions in ${r.room}:`));
        for (const t of r.txs) {
          console.log(`    ${chalk.cyan(t.tx_id.slice(0, 12))}…  kind=${t.kind} amount=$${t.amount_usd.toFixed(4)} ts=${new Date(t.ts).toISOString()}`);
        }
      });
      return true;
    }

    console.error(chalk.red(`  ✗ Unknown subcommand: ${sub}`));
    showHelp();
    return false;
  } catch (err) {
    console.error(chalk.red(`  ✗ ${err && err.message ? err.message : String(err)}`));
    return false;
  }
}
