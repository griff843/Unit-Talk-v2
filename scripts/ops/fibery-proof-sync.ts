/**
 * Fibery Proof Sync — automatically syncs proof artifacts to Fibery
 *
 * Reads proof JSON files from docs/06_status/proof/UTV2-{issue}/,
 * creates Fibery Proof Artifact entities, links them to Controls,
 * and updates Control status.
 *
 * Usage:
 *   npx tsx scripts/ops/fibery-proof-sync.ts                    # sync all unsynced proofs
 *   npx tsx scripts/ops/fibery-proof-sync.ts UTV2-682           # sync specific issue
 *   npx tsx scripts/ops/fibery-proof-sync.ts --dry-run           # preview without writing
 *   npx tsx scripts/ops/fibery-proof-sync.ts --json              # JSON output
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PROOF_DIR = path.join(ROOT, 'docs', '06_status', 'proof');
const FIBERY_API_URL = process.env.FIBERY_API_URL?.trim() ?? '';
const FIBERY_TOKEN = process.env.FIBERY_API_TOKEN?.trim() ?? '';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const jsonMode = args.includes('--json');
const targetIssue = args.find((a) => a.startsWith('UTV2-'));

interface ProofFile {
  issueId: string;
  path: string;
  schema: string;
  run_at: string;
  controls_proven: number;
  controls_total: number;
  proofs: Array<{
    control: string;
    verdict: string;
    notes: string;
  }>;
}

interface SyncResult {
  issueId: string;
  controls_synced: number;
  controls_total: number;
  skipped: boolean;
  reason?: string;
}

async function fiberyCommand(commands: unknown[]): Promise<unknown[]> {
  const response = await fetch(`${FIBERY_API_URL}/api/commands`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${FIBERY_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'unit-talk-fibery-proof-sync',
    },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Fibery API error: HTTP ${response.status}`);
  }

  return (await response.json()) as unknown[];
}

async function findControlByName(controlName: string): Promise<string | null> {
  const results = await fiberyCommand([
    {
      command: 'fibery.entity/query',
      args: {
        query: {
          'q/from': 'Unit Talk/Controls',
          'q/select': { id: 'fibery/id', Name: 'Unit Talk/Name' },
          'q/where': ['=', 'Unit Talk/Name', '$name'],
          'q/limit': 1,
        },
        params: { '$name': controlName },
      },
    },
  ]);

  // Fibery returns [{success: true, result: [...]}] or [result[]]
  const wrapper = results[0] as { success?: boolean; result?: unknown[] } | unknown[];
  const rows = Array.isArray(wrapper) ? wrapper : (wrapper?.result ?? []);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return (rows[0] as { id: string }).id;
}

async function createProofArtifact(name: string, issueId: string, url: string): Promise<string> {
  const results = await fiberyCommand([
    {
      command: 'fibery.entity/create',
      args: {
        type: 'Unit Talk/Proof Artifacts',
        entity: {
          'Unit Talk/Name': name,
          'Unit Talk/Artifact ID': `PROOF-SYNC-${issueId}-${Date.now()}`,
          'Unit Talk/Source System': 'Supabase',
          'Unit Talk/Type': 'Runtime Log',
          'Unit Talk/Verification Level': 'Runtime-Proven',
          'Unit Talk/Verified By': 'Claude Opus 4.6 (automated)',
          'Unit Talk/Created At': new Date().toISOString(),
          'Unit Talk/URL': url,
        },
      },
    },
  ]);

  const wrapper = results[0] as { 'fibery/id'?: string; result?: { 'fibery/id': string } } | { 'fibery/id': string };
  const id = (wrapper as { 'fibery/id': string })['fibery/id'] ?? (wrapper as { result?: { 'fibery/id': string } }).result?.['fibery/id'];
  if (!id) throw new Error('Failed to create proof artifact — no fibery/id in response');
  return id;
}

async function linkArtifactToControl(controlId: string, artifactId: string): Promise<void> {
  await fiberyCommand([
    {
      command: 'fibery.entity/add-collection-items',
      args: {
        type: 'Unit Talk/Controls',
        field: 'Unit Talk/Proof Artifacts',
        entity: { 'fibery/id': controlId },
        items: [{ 'fibery/id': artifactId }],
      },
    },
  ]);
}

async function updateControlStatus(controlId: string, status: string): Promise<void> {
  await fiberyCommand([
    {
      command: 'fibery.entity/update',
      args: {
        type: 'Unit Talk/Controls',
        entity: {
          'fibery/id': controlId,
          'Unit Talk/Status': status,
          'Unit Talk/Last Reviewed At': new Date().toISOString(),
        },
      },
    },
  ]);
}

function discoverProofFiles(): ProofFile[] {
  if (!fs.existsSync(PROOF_DIR)) return [];

  const files: ProofFile[] = [];
  for (const dir of fs.readdirSync(PROOF_DIR)) {
    if (targetIssue && dir !== targetIssue) continue;
    const dirPath = path.join(PROOF_DIR, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;

    for (const file of fs.readdirSync(dirPath)) {
      if (!file.endsWith('.json')) continue;
      try {
        const content = JSON.parse(fs.readFileSync(path.join(dirPath, file), 'utf8'));
        files.push({
          issueId: dir,
          path: path.join(dirPath, file),
          schema: content.schema ?? 'unknown',
          run_at: content.run_at ?? '',
          controls_proven: content.controls_proven ?? 0,
          controls_total: content.controls_total ?? 0,
          proofs: content.proofs ?? [],
        });
      } catch {
        // Skip malformed files
      }
    }
  }

  return files;
}

async function syncProofFile(proof: ProofFile): Promise<SyncResult> {
  const prUrl = `https://github.com/griff843/Unit-Talk-v2`;

  let synced = 0;
  for (const p of proof.proofs) {
    if (p.verdict !== 'PROVEN') continue;

    const controlId = await findControlByName(p.control);
    if (!controlId) {
      if (!jsonMode) console.log(`  [SKIP] Control not found: "${p.control}"`);
      continue;
    }

    if (dryRun) {
      if (!jsonMode) console.log(`  [DRY-RUN] Would sync: "${p.control}" → Proven`);
      synced++;
      continue;
    }

    try {
      const artifactName = `${proof.issueId}: ${p.control.slice(0, 60)} (auto-synced)`;
      const artifactId = await createProofArtifact(artifactName, proof.issueId, prUrl);
      await linkArtifactToControl(controlId, artifactId);
      await updateControlStatus(controlId, 'Proven');
      synced++;
      if (!jsonMode) console.log(`  [SYNCED] ${p.control} → Proven`);
    } catch (err) {
      if (!jsonMode) console.log(`  [ERROR] ${p.control}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    issueId: proof.issueId,
    controls_synced: synced,
    controls_total: proof.proofs.length,
    skipped: false,
  };
}

async function main(): Promise<void> {
  if (!FIBERY_API_URL || !FIBERY_TOKEN) {
    console.log('[fibery-proof-sync] FIBERY_API_URL or FIBERY_API_TOKEN not set — cannot sync');
    process.exitCode = 1;
    return;
  }

  const proofFiles = discoverProofFiles();

  if (!jsonMode) {
    console.log(`[fibery-proof-sync] Found ${proofFiles.length} proof file(s)${dryRun ? ' (DRY RUN)' : ''}\n`);
  }

  const results: SyncResult[] = [];
  for (const proof of proofFiles) {
    if (!jsonMode) console.log(`${proof.issueId} (${proof.controls_proven}/${proof.controls_total} proven):`);
    const result = await syncProofFile(proof);
    results.push(result);
    if (!jsonMode) console.log('');
  }

  const totalSynced = results.reduce((s, r) => s + r.controls_synced, 0);
  const totalControls = results.reduce((s, r) => s + r.controls_total, 0);

  if (jsonMode) {
    console.log(JSON.stringify({ total_synced: totalSynced, total_controls: totalControls, results }, null, 2));
  } else {
    console.log(`Done: ${totalSynced}/${totalControls} controls synced to Fibery${dryRun ? ' (dry run)' : ''}`);
  }
}

main().catch((err) => {
  console.error('[fibery-proof-sync] Fatal:', err);
  process.exitCode = 1;
});
