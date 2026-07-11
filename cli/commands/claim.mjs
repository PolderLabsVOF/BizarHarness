/**
 * cli/commands/claim.mjs
 *
 * F-035 (MetaHarness) — `bizar claim` subcommand surface.
 *
 * Wraps cli/feature-list-bridge.mjs (over feature_list.json).
 *
 * Subcommands:
 *   bizar claim <featureId>                      # claim with --who (or $USER)
 *     --who <id>                                 (default: $USER)
 *     --type <human|agent>                       (default: human)
 *     --reason <text>                            Free-form claim reason
 *   bizar claim release <featureId>              # release
 *     --who <id>                                 Optional claimant check
 *     --reason <text>
 *   bizar claim handoff <featureId> --to <id>    # handoff
 *     --from <id>
 *     --reason <text>
 *   bizar claim steal <featureId> --by <id>       # steal
 *     --type <human|agent>
 *     --reason <steal-reason>                    Must be one of STEAL_REASONS
 *   bizar claim status <featureId>               # Show current claim + history
 *   bizar claim list                              # list all features with status
 *     --status <s>                               One of CLAIM_STATUSES (repeatable)
 *     --by-claimant <id>                         Filter by claimant id
 *     --human-only / --agent-only
 *   bizar claim transition <featureId> <newStatus>     # active|paused|blocked|completed
 *     --who <id>
 *     --reason <text>
 *
 * --json flag for machine output.
 */

import chalk from 'chalk';

import { FeatureListBridge, ClaimError, CLAIM_STATUSES, STEAL_REASONS, defaultFeatureListPath } from '../feature-list-bridge.mjs';

function parseFlags(args) {
  const flags = { _: [], statuses: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') flags.json = true;
    else if (a === '--who' && i + 1 < args.length) { flags.who = args[++i]; }
    else if (a.startsWith('--who=')) flags.who = a.slice('--who='.length);
    else if (a === '--type' && i + 1 < args.length) { flags.type = args[++i]; }
    else if (a.startsWith('--type=')) flags.type = a.slice('--type='.length);
    else if (a === '--reason' && i + 1 < args.length) { flags.reason = args[++i]; }
    else if (a.startsWith('--reason=')) flags.reason = a.slice('--reason='.length);
    else if (a === '--to' && i + 1 < args.length) { flags.to = args[++i]; }
    else if (a.startsWith('--to=')) flags.to = a.slice('--to='.length);
    else if (a === '--from' && i + 1 < args.length) { flags.from = args[++i]; }
    else if (a.startsWith('--from=')) flags.from = a.slice('--from='.length);
    else if (a === '--by' && i + 1 < args.length) { flags.by = args[++i]; }
    else if (a.startsWith('--by=')) flags.by = a.slice('--by='.length);
    else if (a === '--status' && i + 1 < args.length) { flags.statuses.push(args[++i]); }
    else if (a.startsWith('--status=')) flags.statuses.push(a.slice('--status='.length));
    else if (a === '--by-claimant' && i + 1 < args.length) { flags.byClaimant = args[++i]; }
    else if (a.startsWith('--by-claimant=')) flags.byClaimant = a.slice('--by-claimant='.length);
    else if (a === '--human-only') flags.humanOnly = true;
    else if (a === '--agent-only') flags.agentOnly = true;
    else if (a === '--file' && i + 1 < args.length) { flags.file = args[++i]; }
    else if (a.startsWith('--file=')) flags.file = a.slice('--file='.length);
    else if (a === '--help' || a === '-h') flags.help = true;
    else flags._.push(a);
  }
  return flags;
}

function makeClaimant(flags, fallbackId) {
  const id = flags.who || flags.by || fallbackId;
  const type = flags.type || 'human';
  if (!id) return null;
  return { type, id, name: id };
}

function bridge(flags) {
  return new FeatureListBridge({
    filePath: flags.file || defaultFeatureListPath(),
  });
}

function showHelp() {
  console.log(`
  bizar claim — GitHub-ish claim protocol over feature_list.json

  Usage:
    bizar claim <featureId> [--who <id>] [--type human|agent] [--reason <text>]
    bizar claim release <featureId> [--who <id>] [--reason <text>]
    bizar claim handoff <featureId> --to <id> [--from <id>] [--reason <text>]
    bizar claim steal <featureId> --by <id> [--type human|agent] --reason <reason>
    bizar claim status <featureId>
    bizar claim list [--status <s>] [--by-claimant <id>] [--human-only|--agent-only]
    bizar claim transition <featureId> <active|paused|blocked|completed> [--who <id>]

  Steal reasons (must match exactly):
    ${STEAL_REASONS.join(' | ')}

  Status states (must match exactly):
    ${CLAIM_STATUSES.join(' | ')}

  Flags:
    --json                       Machine-readable JSON output
    --file <path>                Override feature_list.json path
    --who <id> / --by <id>       Claimant identifier (default: $USER)
    --type human|agent           Claimant type (default: human)
    --reason <text>              Free-form reason (mandatory for steal)
    --to / --from <id>           Recipient / sender for handoff
    --human-only / --agent-only  Restrict list to human or agent claims
    --status <s>                 Filter list (repeat for multiple)
    --by-claimant <id>           Filter list by claimant id
    --help, -h                   Show this help

  Examples:
    bizar claim F-035 --who odin --reason "porting MetaHarness from ruflo"
    bizar claim steal F-014 --by hermod --reason stale
    bizar claim handoff F-035 --to tyr --from odin
    bizar claim list --status claimed --agent-only
`);
}

function out(result, flags, formatter) {
  if (flags.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else if (formatter) {
    formatter(result);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

export async function run(name, args, isHelpRequest) {
  if (name !== 'claim') return false;
  const flags = parseFlags(args);
  if (flags.help || isHelpRequest) {
    showHelp();
    return true;
  }

  const [sub, ...rest] = flags._;
  const fallback = process.env.USER || 'unknown';
  const who = flags.who || fallback;

  try {
    const br = bridge(flags);

    if (!sub || sub === 'help') {
      showHelp();
      return true;
    }

    if (sub === 'list' || sub === 'ls') {
      const filters = {};
      if (flags.statuses.length) filters.status = flags.statuses;
      if (flags.byClaimant) filters.claimantId = flags.byClaimant;
      if (flags.humanOnly) filters.claimedByHuman = true;
      if (flags.agentOnly) filters.claimedByAgent = true;
      const rows = br.list(filters);
      out({ count: rows.length, features: rows }, flags, (r) => {
        console.log(chalk.bold(`  Claims (${r.count}):`));
        for (const f of r.features) {
          const who = f.claimant ? `${f.claimant.name || f.claimant.id} (${f.claimant.type})` : '—';
          console.log(`    ${chalk.cyan(f.id)} [${f.claimStatus || 'unclaimed'}] by ${who}`);
        }
      });
      return true;
    }

    if (sub === 'status' || sub === 'show' || sub === 'get') {
      const featureId = rest[0];
      if (!featureId) {
        console.error(chalk.red('  ✗ Usage: bizar claim status <featureId>'));
        return false;
      }
      const feature = br.get(featureId);
      out(feature, flags, (f) => {
        console.log(chalk.bold(`  ${chalk.cyan(f.id)} — ${f.behavior || ''}`));
        const who = f.claimant ? `${f.claimant.name || f.claimant.id} (${f.claimant.type})` : 'unclaimed';
        console.log(`    state        = ${f.state}`);
        console.log(`    claim        = ${f.claimStatus || 'unclaimed'} (by ${who})`);
        console.log(`    claimedAt    = ${f.claimedAt || '—'}`);
        console.log(`    claimReason  = ${f.claimReason || '—'}`);
        const hist = Array.isArray(f.claimHistory) ? f.claimHistory : [];
        console.log(`    history      = ${hist.length} event(s)`);
        for (const e of hist.slice(-8)) {
          console.log(`      ${e.ts} ${chalk.dim(e.event)}${e.reason ? ' — ' + e.reason : ''}`);
        }
      });
      return true;
    }

    if (sub === 'release') {
      const featureId = rest[0];
      if (!featureId) {
        console.error(chalk.red('  ✗ Usage: bizar claim release <featureId> [--who <id>] [--reason <text>]'));
        return false;
      }
      const claimant = makeClaimant({ who, type: flags.type }, fallback);
      const result = br.release(featureId, claimant, flags.reason || '');
      out(result, flags, (r) =>
        console.log(chalk.green(`  ✓ Released ${featureId}`) + (r.previousClaimant ? chalk.dim(` (was held by ${r.previousClaimant.name || r.previousClaimant.id})`) : '')),
      );
      return true;
    }

    if (sub === 'handoff') {
      const featureId = rest[0];
      if (!featureId || !flags.to) {
        console.error(chalk.red('  ✗ Usage: bizar claim handoff <featureId> --to <id> [--from <id>] [--reason <text>]'));
        return false;
      }
      const fromClaimant = flags.from ? { type: flags.type || 'human', id: flags.from, name: flags.from } : null;
      const toClaimant = { type: flags.type || 'human', id: flags.to, name: flags.to };
      const result = br.handoff(featureId, fromClaimant, toClaimant, flags.reason || '');
      out(result, flags, (r) =>
        console.log(chalk.green(`  ✓ Handed off ${featureId} → ${flags.to}`)),
      );
      return true;
    }

    if (sub === 'steal') {
      const featureId = rest[0];
      if (!featureId || !flags.by) {
        console.error(chalk.red('  ✗ Usage: bizar claim steal <featureId> --by <id> --reason <reason>'));
        return false;
      }
      if (!flags.reason) {
        console.error(chalk.red('  ✗ steal requires --reason (one of: ' + STEAL_REASONS.join(', ') + ')'));
        return false;
      }
      const newClaimant = { type: flags.type || 'human', id: flags.by, name: flags.by };
      const result = br.steal(featureId, newClaimant, flags.reason);
      out(result, flags, (r) =>
        console.log(chalk.green(`  ✓ Stole ${featureId} (reason: ${r.stealReason}); previous owner: ${r.previousClaimant?.name || r.previousClaimant?.id || '—'}`)),
      );
      return true;
    }

    if (sub === 'transition') {
      const [featureId, newStatus] = rest;
      if (!featureId || !newStatus) {
        console.error(chalk.red('  ✗ Usage: bizar claim transition <featureId> <active|paused|blocked|completed> [--who <id>]'));
        return false;
      }
      if (!CLAIM_STATUSES.includes(newStatus)) {
        console.error(chalk.red(`  ✗ Unknown status '${newStatus}'. Must be one of: ${CLAIM_STATUSES.join(', ')}`));
        return false;
      }
      const claimant = makeClaimant({ who: flags.who, type: flags.type }, fallback);
      const result = br.transition(featureId, newStatus, claimant, flags.reason || '');
      out(result, flags, (r) =>
        console.log(chalk.green(`  ✓ ${featureId} → ${newStatus}` + (r.unchanged ? ' (unchanged)' : ''))),
      );
      return true;
    }

    // Default: `bizar claim <featureId>` — claim it.
    if (!sub.startsWith('-') && sub) {
      const featureId = sub;
      const claimant = makeClaimant({ who: flags.who, type: flags.type }, fallback);
      if (!claimant) {
        console.error(chalk.red('  ✗ No claimant id (set $USER or pass --who <id>)'));
        return false;
      }
      const result = br.claim(featureId, claimant, flags.reason || '');
      out(result, flags, (r) =>
        console.log(chalk.green(`  ✓ Claimed ${featureId} by ${r.feature.claimant.name || r.feature.claimant.id} (${r.feature.claimStatus})`)),
      );
      return true;
    }

    console.error(chalk.red(`  ✗ Unknown subcommand: ${sub}`));
    showHelp();
    return false;
  } catch (err) {
    if (err instanceof ClaimError) {
      console.error(chalk.red(`  ✗ ${err.code}: ${err.message}`));
    } else {
      console.error(chalk.red(`  ✗ ${err && err.message ? err.message : String(err)}`));
    }
    return false;
  }
}
