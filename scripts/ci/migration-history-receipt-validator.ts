/**
 * UTV2-1822 — migration history receipt validator.
 *
 * `supabase db push` refuses to run while any remote ledger version has no local
 * counterpart. The counterparts for the 127 pre-baseline versions are non-executable
 * receipts: they restore correspondence without re-executing DDL the active baseline
 * snapshot already contains.
 *
 * That arrangement is only safe while three things stay true, and none of them is
 * self-enforcing:
 *   1. a receipt never acquires executable SQL (it would replay against a database
 *      that already absorbed it, or collide with the baseline);
 *   2. every receipt still corresponds to a real remote version, and none is lost
 *      (losing one silently re-breaks `db push`);
 *   3. the exact SQL that actually executed stays preserved and unmodified, bound
 *      by hash, outside the replay path.
 *
 * This validator is the mechanical enforcement of all three. It is deliberately
 * file-and-hash based so it runs with no database connection.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Validates the receipt set and returns one message per violation (empty = valid).
 *
 * Exported so the replay drill can refuse to run against an invalid set: replaying
 * receipts that have already failed structural validation would produce a green
 * behavioural result for a set nobody should trust.
 */
export function validateReceipts(repoRoot: string = process.env.REPO_ROOT ?? process.cwd()): string[] {
  const REPO = repoRoot;
  const MIGRATIONS = join(REPO, 'supabase/migrations');
  const MANIFEST_PATH = 'supabase/migrations_archive/ledger/RECEIPTS.json';

  interface Receipt {
    remote_version: string;
    remote_name: string | null;
    receipt_file: string;
    source_kind: 'ledger_payload' | 'archive_fallback';
    source_path: string;
    source_sha256: string;
    archive_intent_path: string | null;
    archive_diverges: boolean | null;
  }

  const failures: string[] = [];
  const fail = (m: string): void => {
    failures.push(m);
  };

  const manifest = JSON.parse(readFileSync(join(REPO, MANIFEST_PATH), 'utf8')) as {
    receipt_version: number;
    baseline: string;
    receipts: Receipt[];
  };

  const EXPECTED_RECEIPTS = 127;
  if (manifest.receipts.length !== EXPECTED_RECEIPTS) {
    fail(`manifest declares ${manifest.receipts.length} receipts; expected exactly ${EXPECTED_RECEIPTS}`);
  }

  // The baseline must remain the replay root: version 00000000000000 sorts first, so
  // every other migration — receipts included — replays after it.
  const baselineFile = manifest.baseline.split('/').pop() as string;
  if (!baselineFile.startsWith('00000000000000_')) {
    fail(`baseline ${manifest.baseline} is not version 00000000000000 and cannot be the replay root`);
  }

  const onDisk = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'));
  const receiptFiles = new Set(manifest.receipts.map((r) => r.receipt_file));
  const seenVersions = new Set<string>();

  for (const r of manifest.receipts) {
    const where = `${r.remote_version} (${r.receipt_file})`;

    if (seenVersions.has(r.remote_version)) fail(`duplicate remote_version ${r.remote_version}`);
    seenVersions.add(r.remote_version);

    // Correspondence is by version prefix — that is what the CLI pairs on.
    if (!r.receipt_file.startsWith(`${r.remote_version}_`)) {
      fail(`${where}: receipt filename does not carry its remote version prefix`);
    }
    if (!onDisk.includes(r.receipt_file)) {
      fail(`${where}: receipt file is missing from supabase/migrations/`);
      continue;
    }

    if (r.source_kind !== 'ledger_payload' && r.source_kind !== 'archive_fallback') {
      fail(`${where}: invalid source_kind ${String(r.source_kind)}`);
    }

    // The preserved historical SQL must exist and still hash to what the receipt binds.
    let sourceBody: string;
    try {
      sourceBody = readFileSync(join(REPO, r.source_path), 'utf8');
    } catch {
      fail(`${where}: source artifact ${r.source_path} does not exist`);
      continue;
    }
    const actual = createHash('sha256').update(sourceBody, 'utf8').digest('hex');
    if (actual !== r.source_sha256) {
      fail(`${where}: source_sha256 mismatch — bound ${r.source_sha256}, actual ${actual}`);
    }

    // Divergence policy: where an archive counterpart exists it must be recorded, and
    // where it diverges the receipt must say so rather than quietly preferring one side.
    if (r.archive_intent_path !== null) {
      if (r.source_kind !== 'ledger_payload') {
        fail(`${where}: archive_intent_path is only meaningful when the ledger payload is the source`);
      }
      if (typeof r.archive_diverges !== 'boolean') {
        fail(`${where}: archive_intent_path recorded without a boolean archive_diverges verdict`);
      }
      try {
        readFileSync(join(REPO, r.archive_intent_path), 'utf8');
      } catch {
        fail(`${where}: archive_intent_path ${r.archive_intent_path} does not exist`);
      }
    }

    // The load-bearing property: a receipt executes nothing.
    //
    // Checked by stripping line comments and requiring what remains to be blank, rather
    // than by scanning for known-dangerous keywords. A denylist fails open on the first
    // statement nobody thought of; "there is nothing here but comments" cannot.
    const body = readFileSync(join(MIGRATIONS, r.receipt_file), 'utf8');
    const residue = body
      .split('\n')
      .map((line) => (line.trimStart().startsWith('--') ? '' : line))
      .join('')
      .trim();
    if (residue !== '') {
      fail(`${where}: receipt contains executable SQL — non-comment content: ${JSON.stringify(residue.slice(0, 120))}`);
    }

    // A receipt asserts subsumption by the baseline; that claim must be present and correct.
    if (!body.includes(`subsumed_by:         ${manifest.baseline}`)) {
      fail(`${where}: receipt does not declare subsumption by ${manifest.baseline}`);
    }
    if (!body.includes(`source_sha256:       ${r.source_sha256}`)) {
      fail(`${where}: receipt body does not carry the manifest's source_sha256`);
    }
  }

  // Nothing may masquerade as a receipt without being in the manifest, and no manifest
  // receipt may be missing: both directions of the correspondence are checked.
  for (const f of onDisk) {
    const isReceipt = readFileSync(join(MIGRATIONS, f), 'utf8').startsWith('-- MIGRATION-HISTORY-RECEIPT');
    if (isReceipt && !receiptFiles.has(f)) {
      fail(`${f}: file declares itself a receipt but is absent from ${MANIFEST_PATH}`);
    }
    if (!isReceipt && receiptFiles.has(f)) {
      fail(`${f}: manifest lists this as a receipt but the file lacks the receipt header`);
    }
  }

  return failures;
}

// CLI entry. Guarded: the replay drill imports validateReceipts, and an unguarded
// top-level process.exit(1) here would abort that caller before it could report which
// phase failed.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cliFailures = validateReceipts();
  if (cliFailures.length > 0) {
    console.error(`migration-history-receipt-validator: FAIL (${cliFailures.length})`);
    for (const f of cliFailures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('migration-history-receipt-validator: PASS');
}
