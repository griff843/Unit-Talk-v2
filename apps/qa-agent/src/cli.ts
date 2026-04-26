#!/usr/bin/env tsx
/**
 * Experience QA Agent CLI
 *
 * Usage:
 *   pnpm qa:experience --product unit-talk --surface command_center --persona operator --flow daily_ops
 *   pnpm qa:experience --surface smart_form --persona operator --flow submit_pick --mode observe
 *   pnpm qa:experience --surface discord --persona free_user --flow access_check
 *   pnpm qa:experience --regression
 */

import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import type { CLIOptions, Environment, RunMode } from './core/types.js';
import { getPersona } from './personas/index.js';
import { getAdapter } from './adapters/registry.js';
import { runSkill } from './runner.js';
import { writeArtifact } from './core/artifact-writer.js';
import { writeIssueReport } from './core/issue-reporter.js';
import { QALedger } from './core/ledger.js';
import { getChangedSurfaces } from './regression/run-changed-surfaces.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_ROOT = resolve(__dirname, '..');

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { args['help'] = true; }
    else if (arg === '--dry-run') { args['dryRun'] = true; }
    else if (arg === '--regression') { args['regression'] = true; }
    else if (arg?.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      args[key] = argv[i + 1] ?? true;
      i++;
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`
Experience QA Agent

USAGE
  pnpm qa:experience [options]

OPTIONS
  --product <id>     Product to test (default: unit-talk)
  --surface <id>     Surface: command_center | smart_form | discord
  --persona <id>     Persona: free_user | trial_user | vip_user | vip_plus_user | operator | admin
  --flow <id>        Flow/skill: daily_ops | submit_pick | access_check | pick_delivery
  --mode <mode>      observe (default) | fast
  --env <env>        local (default) | staging | production
  --output <dir>     Artifacts output dir (default: ./artifacts)
  --regression       Run all skills affected by changed files since main
  --dry-run          Parse and validate options without running browser
  --help             Show this help

EXAMPLES
  pnpm qa:experience --surface command_center --persona operator --flow daily_ops
  pnpm qa:experience --surface smart_form --persona operator --flow submit_pick --mode observe
  pnpm qa:experience --surface discord --persona free_user --flow access_check
  pnpm qa:experience --regression
`);
}

async function main(): Promise<void> {
  const raw = parseArgs(process.argv.slice(2));

  if (raw['help']) { printHelp(); process.exit(0); }

  const artifactsDir = resolve(AGENT_ROOT, (raw['outputDir'] as string | undefined) ?? 'artifacts');
  const ledgerDir = resolve(AGENT_ROOT, 'ledger');

  await mkdir(artifactsDir, { recursive: true });
  await mkdir(ledgerDir, { recursive: true });

  const ledger = new QALedger(ledgerDir);

  if (raw['regression']) {
    const targets = getChangedSurfaces();
    if (targets.length === 0) { console.log('No changed surfaces detected.'); process.exit(0); }
    console.log(`\n[regression] Running ${targets.length} affected surface(s)...\n`);
    let anyFail = false;
    for (const t of targets) {
      const result = await runOne({
        product: t.product, surface: t.surface, persona: t.persona, flow: t.flow,
        mode: (raw['mode'] as RunMode | undefined) ?? 'fast',
        env: (raw['env'] as Environment | undefined) ?? 'local',
        outputDir: artifactsDir, dryRun: (raw['dryRun'] as boolean) ?? false, ledger,
      });
      if (result === 'fail') anyFail = true;
    }
    process.exit(anyFail ? 1 : 0);
    return;
  }

  const opts: CLIOptions = {
    product: (raw['product'] as string | undefined) ?? 'unit-talk',
    surface: raw['surface'] as string,
    persona: raw['persona'] as string,
    flow: raw['flow'] as string,
    mode: (raw['mode'] as RunMode | undefined) ?? 'observe',
    env: (raw['env'] as Environment | undefined) ?? 'local',
    outputDir: artifactsDir,
    dryRun: (raw['dryRun'] as boolean | undefined) ?? false,
  };

  if (!opts.surface || !opts.persona || !opts.flow) {
    console.error('\nError: --surface, --persona, and --flow are required.\n');
    printHelp();
    process.exit(1);
  }

  const exitCode = await runOne({ ...opts, ledger });
  process.exit(exitCode === 'fail' ? 1 : 0);
}

async function runOne(opts: CLIOptions & { ledger: QALedger }): Promise<'pass' | 'fail'> {
  const { product, surface, persona: personaId, flow, mode, env, dryRun, ledger, outputDir } = opts;

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Product:  ${product}`);
  console.log(`  Surface:  ${surface}`);
  console.log(`  Persona:  ${personaId}`);
  console.log(`  Flow:     ${flow}`);
  console.log(`  Mode:     ${mode}`);
  console.log(`  Env:      ${env}`);
  console.log(`${'─'.repeat(60)}\n`);

  const adapter = getAdapter(product);
  const persona = getPersona(personaId);
  const skill = adapter.getSkill(surface, flow);

  if (!skill) {
    console.error(`No skill found for surface="${surface}" flow="${flow}" in product="${product}"`);
    return 'fail';
  }

  if (!skill.supportedPersonas.includes(personaId)) {
    console.warn(`Warning: persona "${personaId}" not in supportedPersonas for "${skill.id}". Supported: ${skill.supportedPersonas.join(', ')}`);
  }

  if (dryRun) {
    console.log('[dry-run] Validation passed. Would run:', skill.id);
    return 'pass';
  }

  const runDir = resolve(outputDir, `${product}-${surface}-${flow}-${personaId}`);
  console.log(`Running: ${skill.description}\n`);

  const result = await runSkill({ skill, persona, adapter, env, mode, artifactsBaseDir: runDir });

  const finalRunDir = resolve(runDir, result.runId);
  const { json: jsonPath, md: mdPath } = await writeArtifact(result, finalRunDir);
  const issuePath = await writeIssueReport(result, finalRunDir);
  const { isRegression } = await ledger.record(result);

  const statusLine =
    result.status === 'PASS' ? `\x1b[32m✓ PASS\x1b[0m`
    : result.status === 'FAIL' || result.status === 'ERROR'
      ? `\x1b[31m✗ ${result.status}\x1b[0m${result.severity ? ` (${result.severity})` : ''}`
      : `\x1b[33m⚠ ${result.status}\x1b[0m`;

  console.log(`\nResult: ${statusLine}`);
  console.log(`Duration: ${result.durationMs}ms`);
  console.log(`Artifact: ${jsonPath}`);
  console.log(`Report:   ${mdPath}`);
  if (issuePath) console.log(`Issue:    ${issuePath}`);
  if (isRegression) console.log(`\x1b[31m⚠ REGRESSION DETECTED: this flow was previously passing\x1b[0m`);

  if (result.uxFriction.length > 0) {
    console.log('\nUX Friction:');
    result.uxFriction.forEach((f) => console.log(`  • ${f}`));
  }

  if (result.consoleErrors.length > 0) {
    console.log('\nConsole Errors:');
    result.consoleErrors.slice(0, 5).forEach((e) => console.log(`  ! ${e.split('\n')[0]}`));
    if (result.consoleErrors.length > 5) console.log(`  ... and ${result.consoleErrors.length - 5} more (see artifact)`);
  }

  console.log('');
  return result.status === 'PASS' || result.status === 'NEEDS_REVIEW' ? 'pass' : 'fail';
}

main().catch((err) => {
  console.error('\nFatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
