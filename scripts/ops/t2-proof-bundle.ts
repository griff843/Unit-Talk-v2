import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ROOT,
  emitJson,
  ensureDir,
  getFlag,
  parseArgs,
  readManifest,
  relativeToRoot,
  requireIssueId,
  type LaneManifest,
} from './shared.js';

const ELIGIBLE_LANE_TYPES = new Set([
  'governance',
  'hygiene',
  'verification',
  'delivery-ui',
  'codex-cli',
]);

export interface T2ProofBundleInput {
  manifest: LaneManifest;
  generatedAt: string;
  diffSummary: string;
  verificationSummary: string;
  rLevelOutput: string;
}

export interface T2ProofGenerateResult {
  ok: boolean;
  code:
    | 'proof_generated'
    | 'proof_ineligible'
    | 'missing_merge_sha'
    | 'missing_expected_proof_paths';
  issue_id: string;
  merge_sha?: string;
  proof_paths: string[];
  generated_paths: string[];
  skipped_paths: string[];
  message: string;
}

export function isEligibleT2OpsLane(manifest: LaneManifest): boolean {
  return manifest.tier === 'T2' && ELIGIBLE_LANE_TYPES.has(manifest.lane_type);
}

export function buildT2ProofBundle(input: T2ProofBundleInput): string {
  const { manifest } = input;
  const mergeSha = manifest.commit_sha?.trim() ?? '';
  return [
    `# ${manifest.issue_id} T2 Ops Proof Bundle`,
    '',
    `Generated at: ${input.generatedAt}`,
    `Issue: ${manifest.issue_id}`,
    `Tier: ${manifest.tier}`,
    `Lane type: ${manifest.lane_type}`,
    `Branch: ${manifest.branch}`,
    `PR URL: ${manifest.pr_url ?? 'N/A'}`,
    `Merge SHA: ${mergeSha}`,
    '',
    '## Diff Summary',
    input.diffSummary.trim() || 'No diff summary supplied.',
    '',
    '## Verification Summary',
    input.verificationSummary.trim() || 'No verification summary supplied.',
    '',
    '## R-level Output',
    input.rLevelOutput.trim() || 'No R-level output supplied.',
    '',
    '## Manifest Files',
    ...(manifest.files_changed.length > 0
      ? manifest.files_changed.map((entry) => `- ${entry}`)
      : ['- No files_changed entries recorded.']),
    '',
    '## SHA Binding',
    `This proof bundle is bound to merge SHA ${mergeSha}.`,
    '',
  ].join('\n');
}

export function generateT2ProofBundle(
  input: T2ProofBundleInput,
  options: { root?: string; force?: boolean } = {},
): T2ProofGenerateResult {
  const { manifest } = input;
  const proofPaths = manifest.expected_proof_paths;
  if (!isEligibleT2OpsLane(manifest)) {
    return {
      ok: false,
      code: 'proof_ineligible',
      issue_id: manifest.issue_id,
      proof_paths: proofPaths,
      generated_paths: [],
      skipped_paths: [],
      message: 'Only T2 governance/hygiene/verification/tooling lanes are eligible for generated proof bundles.',
    };
  }

  const mergeSha = manifest.commit_sha?.trim();
  if (!mergeSha) {
    return {
      ok: false,
      code: 'missing_merge_sha',
      issue_id: manifest.issue_id,
      proof_paths: proofPaths,
      generated_paths: [],
      skipped_paths: [],
      message: 'manifest.commit_sha is required before generating a closeout proof bundle.',
    };
  }

  if (proofPaths.length === 0) {
    return {
      ok: false,
      code: 'missing_expected_proof_paths',
      issue_id: manifest.issue_id,
      merge_sha: mergeSha,
      proof_paths: [],
      generated_paths: [],
      skipped_paths: [],
      message: 'manifest.expected_proof_paths must declare where generated proof should be written.',
    };
  }

  const root = options.root ?? ROOT;
  const force = options.force ?? false;
  const content = buildT2ProofBundle(input);
  const generatedPaths: string[] = [];
  const skippedPaths: string[] = [];

  for (const proofPath of proofPaths) {
    const absolutePath = path.resolve(root, proofPath);
    if (!absolutePath.startsWith(path.resolve(root) + path.sep)) {
      throw new Error(`Proof path escapes repo root: ${proofPath}`);
    }
    if (fs.existsSync(absolutePath) && !force) {
      skippedPaths.push(proofPath);
      continue;
    }

    ensureDir(path.dirname(absolutePath));
    fs.writeFileSync(absolutePath, content, 'utf8');
    generatedPaths.push(proofPath);
  }

  return {
    ok: true,
    code: 'proof_generated',
    issue_id: manifest.issue_id,
    merge_sha: mergeSha,
    proof_paths: proofPaths,
    generated_paths: generatedPaths,
    skipped_paths: skippedPaths,
    message: `Generated ${generatedPaths.length} proof bundle(s); skipped ${skippedPaths.length}.`,
  };
}

function readOptionalFile(filePath: string | undefined): string {
  if (!filePath) {
    return '';
  }
  return fs.readFileSync(path.resolve(ROOT, filePath), 'utf8');
}

function main(argv = process.argv.slice(2)): number {
  const { positionals, flags, bools } = parseArgs(argv);
  const issueId = requireIssueId(getFlag(flags, 'issue') ?? positionals[0] ?? '');
  const manifest = readManifest(issueId);
  const result = generateT2ProofBundle(
    {
      manifest,
      generatedAt: new Date().toISOString(),
      diffSummary: readOptionalFile(getFlag(flags, 'diff-summary')) ||
        `Changed files:\n${manifest.files_changed.map((entry) => `- ${entry}`).join('\n')}`,
      verificationSummary: readOptionalFile(getFlag(flags, 'verification-log')),
      rLevelOutput: readOptionalFile(getFlag(flags, 'r-level-output')),
    },
    { root: ROOT, force: bools.has('force') },
  );

  if (bools.has('json')) {
    emitJson(result);
  } else {
    process.stdout.write(`${result.message}\n`);
    for (const generatedPath of result.generated_paths) {
      process.stdout.write(`generated: ${relativeToRoot(path.resolve(ROOT, generatedPath))}\n`);
    }
    for (const skippedPath of result.skipped_paths) {
      process.stdout.write(`skipped: ${relativeToRoot(path.resolve(ROOT, skippedPath))}\n`);
    }
  }

  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
