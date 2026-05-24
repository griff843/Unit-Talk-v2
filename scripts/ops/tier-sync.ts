#!/usr/bin/env tsx
/**
 * ops:tier-sync — Tier Sync Validator (Workflow Runtime v2, Phase B)
 *
 * Usage:
 *   pnpm ops:tier-sync <ISSUE_ID> --pr <PR_NUMBER> [--json]
 *
 * Fails closed on:
 *   - Linear tier and PR label tier disagree
 *   - tier:T1 label missing on T1 PRs
 *   - lane manifest missing or tier mismatch
 *
 * Labels are evidence, not source of truth. The Linear issue tier is
 * the authoritative source; labels must match it.
 */

import { execFileSync } from 'node:child_process';
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
  pr_tier_label: string | null;
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

function extractTierFromLabels(labels: string[]): string | null {
  for (const label of labels) {
    const m = TIER_LABEL_RE.exec(label);
    if (m) return m[1]?.toUpperCase() ?? null;
  }
  return null;
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
    failures.push(`Lane manifest not found for ${issueId} — cannot verify tier`);
  }

  // --- Load PR labels ---
  let prLabels: string[] = [];
  let prTierLabel: string | null = null;

  if (prNumber != null) {
    prLabels = getPrLabels(prNumber);
    prTierLabel = extractTierFromLabels(prLabels);
  } else {
    warnings.push('No --pr provided — skipping PR label tier check');
  }

  // --- Tier consistency checks ---
  if (manifestTier && prTierLabel) {
    if (manifestTier !== prTierLabel) {
      failures.push(
        `Tier mismatch: manifest tier=${manifestTier} but PR label tier=${prTierLabel}. ` +
        `Labels must match the manifest tier.`,
      );
    }
  } else if (manifestTier && prNumber != null && !prTierLabel) {
    failures.push(
      `PR #${prNumber} is missing a tier label (expected tier:${manifestTier}). ` +
      `Add the label before merge.`,
    );
  }

  // --- T1 strict check: tier:T1 is mandatory ---
  if (manifestTier === 'T1' && prNumber != null) {
    const hasT1Label = prLabels.some(l => l.toLowerCase() === 'tier:t1');
    if (!hasT1Label) {
      failures.push(
        `T1 lane requires tier:T1 label on PR #${prNumber}. ` +
        `This label must be present before merge.`,
      );
    }
  }

  // --- Proof of label-as-evidence (not source of truth) ---
  if (manifestTier && prTierLabel && manifestTier === prTierLabel) {
    // Consistent — acceptable evidence state
  } else if (!manifestTier && prTierLabel) {
    warnings.push(
      `PR has tier label ${prTierLabel} but no lane manifest exists. ` +
      `Tier label alone is not authoritative — lane manifest required.`,
    );
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
    pr_tier_label: prTierLabel,
  };
}

function printHuman(result: TierSyncResult): void {
  console.log(`ops:tier-sync ${result.issue_id}${result.pr_number != null ? ` PR #${result.pr_number}` : ''}`);
  if (result.manifest_tier) console.log(`Manifest tier: ${result.manifest_tier}`);
  if (result.pr_tier_label) console.log(`PR tier label: ${result.pr_tier_label}`);
  if (result.pr_labels.length > 0) console.log(`PR labels: ${result.pr_labels.join(', ')}`);

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

const options = parseCliArgs(process.argv.slice(2));
const result = run(options);

if (options.json) {
  emitJson(result);
} else {
  printHuman(result);
}

process.exitCode = result.verdict === 'PASS' ? 0 : 1;
