import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { FiberyClient, type FiberyEntityLookupResult } from './fibery-client.js';
import {
  loadFiberyPolicy,
  loadSyncMetadata,
  validateSyncMetadata,
  type EntityKind,
} from './fibery-sync-lib.js';
import {
  emitJson,
  getFlag,
  issueToManifestPath,
  parseArgs,
  readManifest,
  relativeToRoot,
  requireIssueId,
  type LaneTier,
} from './shared.js';

type ReadinessCode =
  | 'fibery_readiness_passed'
  | 'fibery_readiness_failed'
  | 'fibery_readiness_unverified';

export type FiberyReadinessResult = {
  ok: boolean;
  code: ReadinessCode;
  issue_id: string;
  tier: LaneTier | null;
  manifest_path: string;
  expected_proof_paths: string[];
  sync_entities: Record<EntityKind, string[]>;
  entity_checks: Array<FiberyEntityLookupResult & { kind: EntityKind }>;
  failures: string[];
};

const ENTITY_KINDS: EntityKind[] = ['issues', 'findings', 'controls', 'proofs'];

export async function evaluateFiberyReadiness(input: {
  issueId: string;
  syncFile: string;
  policyFile: string;
  env?: NodeJS.ProcessEnv;
}): Promise<FiberyReadinessResult> {
  const env = input.env ?? process.env;
  const issueId = requireIssueId(input.issueId);
  const manifestPath = issueToManifestPath(issueId);
  const failures: string[] = [];
  const entityChecks: FiberyReadinessResult['entity_checks'] = [];
  let tier: LaneTier | null = null;
  let expectedProofPaths: string[] = [];
  const emptyEntities: Record<EntityKind, string[]> = {
    issues: [],
    findings: [],
    controls: [],
    proofs: [],
  };

  if (!fs.existsSync(manifestPath)) {
    failures.push(`Missing lane manifest: ${relativeToRoot(manifestPath)}`);
  } else {
    const manifest = readManifest(issueId);
    tier = manifest.tier;
    expectedProofPaths = manifest.expected_proof_paths;
    if (manifest.issue_id !== issueId) {
      failures.push(`Lane manifest issue_id ${manifest.issue_id} does not match ${issueId}`);
    }
    if ((manifest.tier === 'T1' || manifest.tier === 'T2') && manifest.expected_proof_paths.length === 0) {
      failures.push(`${manifest.tier} lane manifest must declare expected_proof_paths`);
    }
  }

  let metadata;
  let policy;
  try {
    metadata = loadSyncMetadata(input.syncFile);
    policy = loadFiberyPolicy(input.policyFile);
  } catch (error) {
    return {
      ok: false,
      code: 'fibery_readiness_failed',
      issue_id: issueId,
      tier,
      manifest_path: relativeToRoot(manifestPath),
      expected_proof_paths: expectedProofPaths,
      sync_entities: emptyEntities,
      entity_checks: entityChecks,
      failures: [...failures, error instanceof Error ? error.message : String(error)],
    };
  }

  failures.push(...validateSyncMetadata(metadata));
  if (!metadata.entities.issues.includes(issueId)) {
    failures.push(`.ops/sync.yml entities.issues must include ${issueId}`);
  }
  if ((tier === 'T1' || tier === 'T2') && metadata.approval.skip_sync_required) {
    failures.push('T1/T2 lanes must keep approval.skip_sync_required: false');
  }
  if ((tier === 'T1' || tier === 'T2') && metadata.entities.proofs.length === 0) {
    failures.push('T1/T2 lanes must declare entities.proofs for the expected proof artifact Fibery entity');
  }
  if (metadata.approval.allow_multiple_issues && metadata.entities.issues.length < 2) {
    failures.push('approval.allow_multiple_issues is allowed only when entities.issues lists multiple issues');
  }

  if (failures.length > 0) {
    return {
      ok: false,
      code: 'fibery_readiness_failed',
      issue_id: issueId,
      tier,
      manifest_path: relativeToRoot(manifestPath),
      expected_proof_paths: expectedProofPaths,
      sync_entities: metadata.entities,
      entity_checks: entityChecks,
      failures,
    };
  }

  const apiUrl = env[policy.fibery.api_url_env]?.trim() ?? '';
  const token = env[policy.fibery.api_token_env]?.trim() ?? '';
  if (!apiUrl || !token) {
    return {
      ok: false,
      code: 'fibery_readiness_unverified',
      issue_id: issueId,
      tier,
      manifest_path: relativeToRoot(manifestPath),
      expected_proof_paths: expectedProofPaths,
      sync_entities: metadata.entities,
      entity_checks: entityChecks,
      failures: [
        `Cannot verify Fibery entities without ${policy.fibery.api_url_env} and ${policy.fibery.api_token_env}`,
      ],
    };
  }

  const client = new FiberyClient({ apiUrl, token });
  for (const kind of ENTITY_KINDS) {
    for (const id of metadata.entities[kind]) {
      const check = await client.verifyEntity(policy.entities[kind], id);
      entityChecks.push({ ...check, kind });
      if (!check.found) {
        failures.push(check.detail);
      }
    }
  }

  return {
    ok: failures.length === 0,
    code: failures.length === 0 ? 'fibery_readiness_passed' : 'fibery_readiness_failed',
    issue_id: issueId,
    tier,
    manifest_path: relativeToRoot(manifestPath),
    expected_proof_paths: expectedProofPaths,
    sync_entities: metadata.entities,
    entity_checks: entityChecks,
    failures,
  };
}

async function main(argv = process.argv.slice(2)): Promise<number> {
  const { positionals, flags, bools } = parseArgs(argv);
  const issueId = positionals[0] ?? getFlag(flags, 'issue') ?? '';
  const result = await evaluateFiberyReadiness({
    issueId,
    syncFile: getFlag(flags, 'sync-file') ?? '.ops/sync.yml',
    policyFile: getFlag(flags, 'policy-file') ?? '.ops/fibery-policy.yml',
  });

  if (bools.has('json')) {
    emitJson(result);
  } else {
    printHuman(result);
  }
  return result.ok ? 0 : 1;
}

function printHuman(result: FiberyReadinessResult): void {
  console.log(`Fibery readiness: ${result.code}`);
  console.log(`Issue: ${result.issue_id}`);
  console.log(`Manifest: ${result.manifest_path}`);
  if (result.tier) {
    console.log(`Tier: ${result.tier}`);
  }
  if (result.expected_proof_paths.length > 0) {
    console.log(`Expected proof paths: ${result.expected_proof_paths.join(', ')}`);
  }
  for (const kind of ENTITY_KINDS) {
    console.log(`${kind}: ${result.sync_entities[kind].join(', ') || '(none)'}`);
  }
  if (result.entity_checks.length > 0) {
    console.log('Entity checks:');
    for (const check of result.entity_checks) {
      console.log(`- ${check.kind} ${check.entity_id}: ${check.found ? 'found' : 'missing'}`);
    }
  }
  if (result.failures.length > 0) {
    console.error('Failures:');
    for (const failure of result.failures) {
      console.error(`- ${failure}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      emitJson({
        ok: false,
        code: 'fibery_readiness_failed',
        failures: [error instanceof Error ? error.message : String(error)],
      });
      process.exitCode = 1;
    });
}
