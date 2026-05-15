import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isLaneType, loadLaneManifest, type LaneType } from './lane-contract.js';
import { emitJson, getFlag, parseArgs, requireIssueId } from './ops/shared.js';

export interface ProofCheckResult {
  ok: boolean;
  issue: string;
  lane: LaneType;
  proofDir: string;
  required: string[];
  missing: string[];
}

export function validateProofBundle(input: {
  issue: string;
  lane: LaneType;
  repoRoot?: string;
  proofRoot?: string;
}): ProofCheckResult {
  const repoRoot = input.repoRoot ?? process.cwd();
  const issue = requireIssueId(input.issue);
  const manifest = loadLaneManifest(input.lane, repoRoot);
  const proofRoot = input.proofRoot ?? path.join(repoRoot, 'proof');
  const proofDir = path.join(proofRoot, issue);
  const missing = manifest.required_proof_artifacts.filter(
    (artifact) => !fs.existsSync(path.join(proofDir, artifact)),
  );

  return {
    ok: missing.length === 0,
    issue,
    lane: input.lane,
    proofDir: path.relative(repoRoot, proofDir).replaceAll('\\', '/'),
    required: manifest.required_proof_artifacts,
    missing,
  };
}

function main(): void {
  const { flags, bools } = parseArgs(process.argv.slice(2));
  const issue = getFlag(flags, 'issue');
  const lane = getFlag(flags, 'lane') ?? process.env.LANE_TYPE ?? '';
  const json = bools.has('json');

  try {
    if (!issue) {
      throw new Error('Missing --issue UTV2-XXXX');
    }
    if (!isLaneType(lane)) {
      throw new Error('Missing or invalid lane. Pass --lane <type> or set LANE_TYPE.');
    }

    const result = validateProofBundle({ issue, lane });
    if (json) {
      emitJson({
        ok: result.ok,
        code: result.ok ? 'proof_bundle_pass' : 'proof_bundle_fail',
        issue: result.issue,
        lane: result.lane,
        proof_dir: result.proofDir,
        required: result.required,
        missing: result.missing,
      });
    } else if (result.ok) {
      console.log(`proof:check PASS issue=${result.issue} lane=${result.lane}`);
    } else {
      console.error(`proof:check FAIL issue=${result.issue} lane=${result.lane}`);
      console.error(`Proof dir: ${result.proofDir}`);
      for (const artifact of result.missing) {
        console.error(`- missing: ${artifact}`);
      }
    }

    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      emitJson({ ok: false, code: 'proof_check_error', message });
    } else {
      console.error(message);
    }
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
