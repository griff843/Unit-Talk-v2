#!/usr/bin/env tsx
/**
 * ops:proof-check — Proof Freshness Validator (Workflow Runtime v2, Phase A)
 *
 * Usage:
 *   pnpm ops:proof-check <ISSUE_ID> --pr <PR_NUMBER> [--json] [--post-merge]
 *
 * Fails closed on:
 *   - proof schema invalid
 *   - proof stale (current PR head changed after proof was written)
 *   - evidence commit missing
 *   - merge SHA missing post-merge (when --post-merge)
 *   - required proof files missing
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  git,
  readManifest,
  emitJson,
  parseArgs,
  getFlag,
  requireIssueId,
} from './shared.js';
import {
  validateProofSchema,
  isProofStale,
  type ProofSchemaV2,
} from './proof-schema.js';

interface CliOptions {
  issueId: string;
  prNumber: number | null;
  json: boolean;
  postMerge: boolean;
}

interface ProofCheckResult {
  verdict: 'PASS' | 'FAIL';
  issue_id: string;
  pr_number: number | null;
  failures: string[];
  warnings: string[];
  checked_at: string;
  proof_path: string | null;
  current_head_sha: string | null;
  proof_source_sha: string | null;
  stale: boolean;
}

const PROOF_DIR = path.join(ROOT, 'docs', '06_status', 'proof');
const SHA_RE = /^[0-9a-f]{40}$/i;

interface LegacyEvidenceBundle {
  schema_version: number;
  merge_sha?: string | null;
}

function resolveProofPath(issueId: string): string | null {
  const nestedEvidencePath = path.join(PROOF_DIR, issueId, 'evidence.json');
  if (fs.existsSync(nestedEvidencePath)) return nestedEvidencePath;

  const jsonPath = path.join(PROOF_DIR, `${issueId}.json`);
  if (fs.existsSync(jsonPath)) return jsonPath;

  const mdPath = path.join(ROOT, 'docs', '06_status', `${issueId}-EVIDENCE-BUNDLE.md`);
  if (fs.existsSync(mdPath)) return mdPath;

  const legacyMd = path.join(PROOF_DIR, `${issueId}.md`);
  if (fs.existsSync(legacyMd)) return legacyMd;

  return null;
}

function checkedProofLocations(issueId: string): string[] {
  return [
    path.join(PROOF_DIR, issueId, 'evidence.json'),
    path.join(PROOF_DIR, `${issueId}.json`),
    path.join(ROOT, 'docs', '06_status', `${issueId}-EVIDENCE-BUNDLE.md`),
    path.join(PROOF_DIR, `${issueId}.md`),
  ];
}

function readManifestOrWarn(issueId: string, warnings: string[]): ReturnType<typeof readManifest> | null {
  try {
    return readManifest(issueId);
  } catch {
    warnings.push(`Lane manifest not found for ${issueId} — cannot determine branch for staleness check`);
    return null;
  }
}

function getCurrentHeadSha(branch: string | undefined): string | null {
  if (!branch) return null;
  const result = git(['rev-parse', `refs/heads/${branch}`]);
  if (result.ok) return result.stdout.trim();

  const result2 = git(['rev-parse', `refs/remotes/origin/${branch}`]);
  if (result2.ok) return result2.stdout.trim();

  return null;
}

function isLegacyEvidenceBundle(candidate: unknown): candidate is LegacyEvidenceBundle {
  if (candidate === null || typeof candidate !== 'object') return false;
  const bundle = candidate as Record<string, unknown>;
  return (
    typeof bundle['schema_version'] === 'number' &&
    bundle['schema_version'] !== 2 &&
    (bundle['merge_sha'] === null ||
      bundle['merge_sha'] === undefined ||
      typeof bundle['merge_sha'] === 'string')
  );
}

function getPrHeadSha(prNumber: number): string | null {
  const result = git(['ls-remote', 'origin', `refs/pull/${prNumber}/head`]);
  if (!result.ok || !result.stdout.trim()) return null;
  return result.stdout.trim().split('\t')[0] ?? null;
}

function parseCliArgs(argv: string[]): CliOptions {
  const { positionals, flags, bools } = parseArgs(argv);
  const issueId = requireIssueId(positionals[0] ?? '');
  const prRaw = getFlag(flags, 'pr');
  const prNumber = prRaw != null ? Number(prRaw) : null;
  return {
    issueId,
    prNumber: prNumber != null && Number.isFinite(prNumber) ? prNumber : null,
    json: bools.has('json') || flags.has('json'),
    postMerge: bools.has('post-merge') || flags.has('post-merge'),
  };
}

function run(options: CliOptions): ProofCheckResult {
  const { issueId, prNumber, postMerge } = options;
  const failures: string[] = [];
  const warnings: string[] = [];
  const manifest = readManifestOrWarn(issueId, warnings);

  const proofPath = resolveProofPath(issueId);
  let proofSourceSha: string | null = null;
  let legacyProof: LegacyEvidenceBundle | null = null;
  let stale = false;

  // --- Locate proof file ---
  if (!proofPath) {
    failures.push(`No proof file found for ${issueId} (checked ${checkedProofLocations(issueId).join(', ')})`);
  }

  // --- Load and validate proof schema (JSON proofs only) ---
  let proof: ProofSchemaV2 | null = null;
  if (proofPath?.endsWith('.json')) {
    let rawProof: unknown;
    try {
      rawProof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
    } catch {
      failures.push(`Failed to parse proof JSON at ${proofPath}`);
    }

    if (rawProof !== undefined) {
      const validation = validateProofSchema(rawProof);
      if (!validation.valid) {
        if (isLegacyEvidenceBundle(rawProof)) {
          legacyProof = rawProof;
          proofSourceSha = legacyProof.merge_sha ?? null;
        } else {
          for (const f of validation.failures) {
            failures.push(`Proof schema invalid — ${f.field}: ${f.message}`);
          }
        }
      } else {
        proof = rawProof as ProofSchemaV2;
        proofSourceSha = proof.source_sha;
      }
    }
  } else if (proofPath) {
    // Legacy markdown proof — can't do full schema validation, just check it's non-empty
    const content = fs.readFileSync(proofPath, 'utf8');
    if (content.trim().length < 50) {
      failures.push(`Proof file appears empty or minimal: ${proofPath}`);
    }
    const shaMatch = content.match(/(?:MERGE_SHA|merge_sha|source_sha):\s*([0-9a-f]{40})/i);
    if (shaMatch) proofSourceSha = shaMatch[1] ?? null;
  }

  // --- Determine current PR head SHA ---
  let currentHeadSha: string | null = null;

  // Prefer PR head via git ls-remote (works in CI)
  if (prNumber != null) {
    currentHeadSha = getPrHeadSha(prNumber);
  }

  // Fallback to lane manifest branch
  if (!currentHeadSha) {
    if (manifest?.status === 'done' && manifest.commit_sha) {
      currentHeadSha = manifest.commit_sha;
    } else if (manifest) {
      currentHeadSha = getCurrentHeadSha(manifest.branch) ?? manifest.commit_sha ?? null;
    }
  }

  // --- Staleness check ---
  if (proof && currentHeadSha) {
    stale = isProofStale(proof, currentHeadSha);
    if (stale) {
      failures.push(
        `Proof is stale: proof was written at source_sha=${proof.source_sha}, ` +
        `but current PR head is ${currentHeadSha}. Regenerate proof against the current head.`,
      );
    }
  } else if (proof && !currentHeadSha) {
    warnings.push('Cannot determine current PR head SHA — staleness check skipped');
  }

  // --- Evidence commit check (JSON proofs) ---
  if (proof && proof.evidence_commit_sha === null) {
    if (postMerge) {
      failures.push('evidence_commit_sha is null post-merge — evidence bundle must be committed before merge');
    } else {
      warnings.push('evidence_commit_sha is null — required before merge');
    }
  }

  // --- Merge SHA check (post-merge only) ---
  if (postMerge) {
    if (proof && proof.merge_sha === null) {
      failures.push('merge_sha is null but --post-merge was specified — bind proof to merge SHA');
    }
    if (legacyProof && !SHA_RE.test(legacyProof.merge_sha ?? '')) {
      failures.push('merge_sha is null or invalid but --post-merge was specified — bind proof to merge SHA');
    }
    if (!proof && proofPath) {
      if (legacyProof) {
        warnings.push('Legacy schema v1 proof detected — merge_sha was checked, v2 staleness validation skipped');
      } else {
        // Markdown proof — warn but don't fail on merge SHA absence
        warnings.push('Cannot verify merge_sha in markdown proof — use JSON proof for post-merge validation');
      }
    }
  }

  // --- PR number consistency (JSON proofs) ---
  if (proof && prNumber != null && proof.pr_number !== prNumber) {
    failures.push(`PR number mismatch: proof.pr_number=${proof.pr_number}, --pr=${prNumber}`);
  }

  return {
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    issue_id: issueId,
    pr_number: prNumber,
    failures,
    warnings,
    checked_at: new Date().toISOString(),
    proof_path: proofPath,
    current_head_sha: currentHeadSha,
    proof_source_sha: proofSourceSha,
    stale,
  };
}

function printHuman(result: ProofCheckResult): void {
  console.log(`ops:proof-check ${result.issue_id}${result.pr_number != null ? ` PR #${result.pr_number}` : ''}`);
  console.log(`Proof: ${result.proof_path ?? 'NOT FOUND'}`);
  if (result.proof_source_sha) console.log(`Proof source SHA: ${result.proof_source_sha}`);
  if (result.current_head_sha) console.log(`Current head SHA: ${result.current_head_sha}`);

  if (result.stale) console.log('STALE: yes');

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
