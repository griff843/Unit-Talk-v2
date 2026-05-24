#!/usr/bin/env tsx
/**
 * ops:tier-sync — Tier Sync Validator (Workflow Runtime v2, Phase B)
 *
 * Usage:
 *   pnpm ops:tier-sync <ISSUE_ID> --pr <PR_NUMBER> [--sync] [--json]
 *
 * Fails closed on:
 *   - Linear tier and PR label tier disagree
 *   - lane manifest missing or invalid
 *   - no authoritative tier
 *
 * Labels are evidence, not source of truth. The lane manifest carries
 * the authoritative tier mirrored from Linear; labels must match it.
 */

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  ROOT,
  emitJson,
  parseArgs,
  getFlag,
  requireIssueId,
  readManifest,
  type LaneTier,
} from './shared.js';

interface CliOptions {
  issueId: string;
  prNumber: number | null;
  sync: boolean;
  json: boolean;
}

interface TierSyncResult {
  verdict: 'PASS' | 'FAIL';
  issue_id: string;
  pr_number: number | null;
  failures: string[];
  warnings: string[];
  checked_at: string;
  manifest_tier: LaneTier | null;
  pr_labels: string[];
  pr_tier_labels: string[];
  expected_label: string | null;
  actions: TierSyncAction[];
}

export type TierSyncAction =
  | { type: 'add'; label: string; reason: string }
  | { type: 'remove'; label: string; reason: string };

export interface TierSyncEvaluationInput {
  issueId: string;
  manifestTier: LaneTier | null;
  prNumber: number | null;
  prLabels: string[];
  sync: boolean;
}

export interface TierSyncEvaluation {
  failures: string[];
  warnings: string[];
  prTierLabels: string[];
  expectedLabel: string | null;
  actions: TierSyncAction[];
}

const TIER_LABEL_RE = /^tier:(T[123])$/i;

function parseCliArgs(argv: string[]): CliOptions {
  const { positionals, flags, bools } = parseArgs(argv);
  const issueId = requireIssueId(positionals[0] ?? '');
  const prRaw = getFlag(flags, 'pr');
  const prNumber = prRaw != null ? Number(prRaw) : null;
  return {
    issueId,
    prNumber: prNumber != null && Number.isFinite(prNumber) ? prNumber : null,
    sync: bools.has('sync') || flags.has('sync'),
    json: bools.has('json') || flags.has('json'),
  };
}

function getPrLabels(prNumber: number): string[] {
  try {
    const out = execFileSync('gh', [
      'pr', 'view', String(prNumber),
      '--json', 'labels',
      '--jq', '.labels[].name',
    ], { encoding: 'utf8', cwd: ROOT }).trim();
    return out ? out.split('\n') : [];
  } catch {
    return [];
  }
}

function editPrLabel(prNumber: number, action: TierSyncAction): void {
  const flag = action.type === 'add' ? '--add-label' : '--remove-label';
  execFileSync('gh', ['pr', 'edit', String(prNumber), flag, action.label], {
    encoding: 'utf8',
    cwd: ROOT,
    stdio: 'pipe',
  });
}

export function extractTierLabels(labels: string[]): string[] {
  return labels
    .filter((label) => TIER_LABEL_RE.test(label))
    .map((label) => {
      const match = TIER_LABEL_RE.exec(label);
      return `tier:${match?.[1]?.toUpperCase()}`;
    });
}

export function evaluateTierSync(input: TierSyncEvaluationInput): TierSyncEvaluation {
  const failures: string[] = [];
  const warnings: string[] = [];
  const actions: TierSyncAction[] = [];
  const prTierLabels = extractTierLabels(input.prLabels);
  const expectedLabel = input.manifestTier ? `tier:${input.manifestTier}` : null;

  if (!input.manifestTier) {
    failures.push(
      `No authoritative tier found for ${input.issueId}. ` +
      'Lane manifest tier is required; a GitHub label alone cannot authorize merge.',
    );
    return { failures, warnings, prTierLabels, expectedLabel, actions };
  }

  if (input.prNumber == null) {
    warnings.push('No --pr provided — skipping GitHub label synchronization');
    return { failures, warnings, prTierLabels, expectedLabel, actions };
  }

  const uniqueTierLabels = [...new Set(prTierLabels)];
  const hasExpected = uniqueTierLabels.includes(expectedLabel);
  const unexpected = uniqueTierLabels.filter((label) => label !== expectedLabel);

  if (uniqueTierLabels.length === 0) {
    const reason = `PR #${input.prNumber} is missing ${expectedLabel}; applying authoritative lane tier`;
    actions.push({ type: 'add', label: expectedLabel, reason });
    if (!input.sync) {
      failures.push(
        `${reason}. Re-run with --sync or let Tier Label Check apply it automatically.`,
      );
    }
    return { failures, warnings, prTierLabels, expectedLabel, actions };
  }

  if (unexpected.length > 0 || uniqueTierLabels.length > 1 || !hasExpected) {
    for (const label of unexpected) {
      actions.push({
        type: 'remove',
        label,
        reason: `Remove stale GitHub evidence ${label}; authoritative tier is ${expectedLabel}`,
      });
    }
    if (!hasExpected) {
      actions.push({
        type: 'add',
        label: expectedLabel,
        reason: `Apply authoritative lane tier ${expectedLabel}`,
      });
    }
    failures.push(
      `Tier drift: authoritative lane tier is ${expectedLabel}, ` +
      `but PR has ${uniqueTierLabels.join(', ')}. Drift is corrected by automation when --sync is enabled, ` +
      'but this validation fails closed so stale/manual labels cannot authorize merge.',
    );
  }

  return { failures, warnings, prTierLabels, expectedLabel, actions };
}

function run(options: CliOptions): TierSyncResult {
  const { issueId, prNumber } = options;
  const failures: string[] = [];
  const warnings: string[] = [];

  // --- Load lane manifest tier ---
  let manifestTier: LaneTier | null = null;
  try {
    const manifest = readManifest(issueId);
    manifestTier = manifest.tier;
  } catch {
    failures.push(
      `Lane manifest not found for ${issueId} — cannot verify authoritative tier. ` +
      'GitHub labels are evidence only.',
    );
  }

  // --- Load PR labels ---
  let prLabels: string[] = [];

  if (prNumber != null) {
    prLabels = getPrLabels(prNumber);
  } else {
    warnings.push('No --pr provided — skipping PR label tier check');
  }

  const evaluation = evaluateTierSync({
    issueId,
    manifestTier,
    prNumber,
    prLabels,
    sync: options.sync,
  });

  failures.push(...evaluation.failures);
  warnings.push(...evaluation.warnings);

  if (options.sync && prNumber != null) {
    for (const action of evaluation.actions) {
      try {
        editPrLabel(prNumber, action);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`Failed to ${action.type} ${action.label} on PR #${prNumber}: ${message}`);
      }
    }
  }

  return {
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    issue_id: issueId,
    pr_number: prNumber,
    failures,
    warnings,
    checked_at: new Date().toISOString(),
    manifest_tier: manifestTier,
    pr_labels: prLabels,
    pr_tier_labels: evaluation.prTierLabels,
    expected_label: evaluation.expectedLabel,
    actions: evaluation.actions,
  };
}

function printHuman(result: TierSyncResult): void {
  console.log(`ops:tier-sync ${result.issue_id}${result.pr_number != null ? ` PR #${result.pr_number}` : ''}`);
  if (result.manifest_tier) console.log(`Manifest tier: ${result.manifest_tier}`);
  if (result.expected_label) console.log(`Expected PR label: ${result.expected_label}`);
  if (result.pr_tier_labels.length > 0) console.log(`PR tier labels: ${result.pr_tier_labels.join(', ')}`);
  if (result.pr_labels.length > 0) console.log(`PR labels: ${result.pr_labels.join(', ')}`);
  if (result.actions.length > 0) {
    console.log('\nSync actions:');
    for (const action of result.actions) {
      console.log(`  ${action.type.toUpperCase()} ${action.label} — ${action.reason}`);
    }
  }

  if (result.failures.length > 0) {
    console.log('\nFailures:');
    for (const f of result.failures) console.log(`  FAIL  ${f}`);
  }
  if (result.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const w of result.warnings) console.log(`  WARN  ${w}`);
  }

  console.log(`\nVerdict: ${result.verdict}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseCliArgs(process.argv.slice(2));
  const result = run(options);

  if (options.json) {
    emitJson(result);
  } else {
    printHuman(result);
  }

  process.exitCode = result.verdict === 'PASS' ? 0 : 1;
}
