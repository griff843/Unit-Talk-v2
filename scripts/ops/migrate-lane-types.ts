#!/usr/bin/env tsx
/**
 * Normalizes legacy lane_type values in manifests.
 *
 * Before UTV2-961, lane manifests used executor values as lane_type:
 *   lane_type: "claude" | "codex" | "codex-cli" | "codex-cloud"
 *
 * After UTV2-961, the schema separates concerns:
 *   lane_type: canonical domain type (runtime | modeling | verification | ...)
 *   executor:  execution tool (claude | codex-cli | codex-cloud)
 *
 * Usage:
 *   tsx scripts/ops/migrate-lane-types.ts            # dry-run (print plan)
 *   tsx scripts/ops/migrate-lane-types.ts --apply    # apply changes
 *   tsx scripts/ops/migrate-lane-types.ts --active   # only non-done manifests
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from './shared.js';

const MANIFEST_DIR = path.join(process.cwd(), 'docs', '06_status', 'lanes');

const CANONICAL_TYPES = new Set([
  'runtime',
  'modeling',
  'verification',
  'hygiene',
  'migration',
  'governance',
  'delivery-ui',
  'data-canonical',
]);

const DONE_STATUSES = new Set(['done', 'closed', 'cancelled']);

const EXECUTOR_MAP: Record<string, string> = {
  claude: 'claude',
  codex: 'codex-cli',
  'codex-cli': 'codex-cli',
  'codex-cloud': 'codex-cloud',
};

function inferCanonicalType(branch: string, _issueId: string): string {
  const b = branch.toLowerCase();
  if (/governance|policy|audit|spec|contract|taxonomy|proof-bundle/.test(b)) return 'governance';
  if (/migration|schema|database|supabase/.test(b)) return 'migration';
  if (/model|scoring|clv|pick-score|elite|human-like/.test(b)) return 'modeling';
  if (/verif|proof|test|evidence/.test(b)) return 'verification';
  if (/hygiene|cleanup|lint|format|debt/.test(b)) return 'hygiene';
  if (/delivery-ui|command-center|discord-ui/.test(b)) return 'delivery-ui';
  if (/data-canonical|canonical|ingest/.test(b)) return 'data-canonical';
  return 'runtime';
}

function main(): void {
  const { bools } = parseArgs(process.argv.slice(2));
  const apply = bools.has('apply');
  const activeOnly = bools.has('active');

  const files = fs.readdirSync(MANIFEST_DIR).filter((f) => f.endsWith('.json'));
  let migrated = 0;
  let skipped = 0;

  for (const file of files) {
    const filePath = path.join(MANIFEST_DIR, file);
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    } catch {
      console.warn(`SKIP: ${file} — parse error`);
      skipped++;
      continue;
    }

    const laneType = manifest['lane_type'] as string | undefined;
    if (!laneType || CANONICAL_TYPES.has(laneType)) {
      skipped++;
      continue;
    }

    const status = manifest['status'] as string | undefined;
    if (activeOnly && status && DONE_STATUSES.has(status)) {
      skipped++;
      continue;
    }

    const executor = EXECUTOR_MAP[laneType];
    if (!executor) {
      console.warn(`SKIP: ${file} — unknown lane_type "${laneType}"`);
      skipped++;
      continue;
    }

    const branch = (manifest['branch'] as string | undefined) ?? '';
    const issueId = (manifest['issue_id'] as string | undefined) ?? file.replace('.json', '');
    const canonicalType = inferCanonicalType(branch, issueId);

    console.log(
      `${apply ? 'MIGRATE' : 'PLAN'}  ${file}: lane_type "${laneType}" → "${canonicalType}", executor "${executor}"`,
    );

    if (apply) {
      manifest['lane_type'] = canonicalType;
      manifest['executor'] = executor;
      fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
      migrated++;
    } else {
      migrated++;
    }
  }

  console.log(
    `\n${apply ? 'Migrated' : 'Would migrate'} ${migrated} manifests, skipped ${skipped}.`,
  );
  if (!apply && migrated > 0) {
    console.log('Run with --apply to apply changes.');
  }
}

main();
