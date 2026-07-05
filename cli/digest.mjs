/**
 * cli/digest.mjs
 *
 * v4.8.0 — `bizar digest` CLI subcommand.
 *
 * Usage:
 *   bizar digest                  Show latest digest
 *   bizar digest list             List all digests
 *   bizar digest generate [--days N]  Generate now (default 7 days)
 *   bizar digest view <path>      View a specific digest
 *   bizar digest delete <path>    Delete a specific digest
 */
import chalk from 'chalk';
import { readFileSync, existsSync } from 'node:fs';

function showDigestHelp() {
  console.log(`
  bizar digest — Manage weekly digests

  Usage:
    bizar digest                     Show the latest digest
    bizar digest list                List all digests
    bizar digest generate [--days N] Generate a digest now (default 7 days)
    bizar digest view <path>         View a specific digest
    bizar digest delete <path>       Delete a specific digest
    bizar digest --help              Show this help
  `);
}

export async function runDigest(subcommand, args) {
  const { generateAndSave, listDigests, getDigest, deleteDigest } = await import(
    '../bizar-dash/src/server/digest-store.mjs'
  );

  switch (subcommand) {
    case undefined:
    case null:
    case '': {
      // Show latest digest
      const digests = await listDigests({ limit: 1 });
      if (digests.length === 0) {
        console.log(chalk.yellow('  No digests yet. Run `bizar digest generate` to create one.'));
        return;
      }
      const latest = digests[0];
      const digest = await getDigest(latest.path);
      if (!digest) {
        console.log(chalk.red(`  ✗ Digest not found at ${latest.path}`));
        return;
      }
      console.log(digest.content);
      break;
    }

    case 'list': {
      const digests = await listDigests({ limit: 50 });
      if (digests.length === 0) {
        console.log(chalk.yellow('  No digests yet.'));
        return;
      }
      console.log(chalk.bold(`  ${digests.length} digest(s):\n`));
      for (const d of digests) {
        const date = new Date(d.createdAt).toLocaleDateString();
        const size = (d.sizeBytes / 1024).toFixed(1);
        console.log(`  ${chalk.cyan(d.filename)}`);
        console.log(`    Path: ${d.path}`);
        console.log(`    Created: ${date}  (${size} KB)`);
        console.log();
      }
      break;
    }

    case 'generate': {
      const daysIdx = args.indexOf('--days');
      const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1], 10) || 7 : 7;
      const dryRun = args.includes('--dry-run');
      const now = new Date();
      const weekEnd = now.toISOString().slice(0, 10);
      const weekStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      console.log(chalk.bold(`  Generating digest for ${weekStart} → ${weekEnd}...`));
      if (dryRun) console.log(chalk.yellow('  (dry run — will not save)'));

      const result = await generateAndSave({
        weekStart,
        weekEnd,
        projectRoot: process.cwd(),
        dryRun,
      });

      if (result.dryRun) {
        console.log('\n' + result.markdown);
      } else {
        console.log(chalk.green(`  ✓ Digest saved:`));
        for (const p of result.saveResult.paths) {
          console.log(`    ${p}`);
        }
        console.log(chalk.green(`  Sections: ${Object.keys(result.sections).filter(k => Array.isArray(result.sections[k]) ? result.sections[k].length > 0 : result.sections[k] !== null).length}/7 populated`));
      }
      break;
    }

    case 'view': {
      const path = args[0];
      if (!path) {
        console.log(chalk.red('  ✗ Usage: bizar digest view <path>'));
        process.exit(1);
      }
      if (!existsSync(path)) {
        console.log(chalk.red(`  ✗ File not found: ${path}`));
        process.exit(1);
      }
      const digest = await getDigest(path);
      if (!digest) {
        console.log(chalk.red(`  ✗ Could not read digest at ${path}`));
        process.exit(1);
      }
      console.log(digest.content);
      break;
    }

    case 'delete': {
      const path = args[0];
      if (!path) {
        console.log(chalk.red('  ✗ Usage: bizar digest delete <path>'));
        process.exit(1);
      }
      const result = await deleteDigest(path);
      if (result.ok) {
        console.log(chalk.green(`  ✓ Deleted ${path}`));
      } else {
        console.log(chalk.red(`  ✗ Delete failed: ${result.error || 'unknown'}`));
        process.exit(1);
      }
      break;
    }

    default:
      if (subcommand === '--help' || subcommand === '-h') {
        showDigestHelp();
      } else {
        console.log(chalk.red(`  ✗ Unknown digest subcommand: ${subcommand}`));
        showDigestHelp();
        process.exit(1);
      }
  }
}
