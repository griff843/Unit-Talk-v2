import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { type DuckConnection, quote } from './duckdb.js';
import {
  type ArchiveManifestV1,
  isPruneEligible,
  type ManifestVerification,
  validateManifest,
} from './manifest.js';
import { type ObjectStore, sha256Hex } from './object-store.js';

/**
 * Fail-closed archive verification.
 *
 * The rule this module exists to enforce, stated once: **a production row or
 * partition never becomes prune-eligible because an upload returned success.**
 * An upload returning 200 tells you a request completed. It does not tell you
 * the object is there, that it holds the rows you think it holds, that those
 * bytes are the bytes you hashed, or that anything can read them back.
 *
 * So every check below re-reads the object *from the store*, never from the
 * local file the exporter just wrote. Verifying the local copy would prove the
 * exporter can write a file -- which was never in doubt -- and would leave the
 * one step that can actually lose data, the upload, unverified.
 *
 * Every check is independently recorded and every failure is named. `passed` is
 * a conjunction computed here; no caller can set it.
 */

export const DEFAULT_SAMPLE_SIZE = 100;

export interface VerificationCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export interface VerificationReport {
  data_key: string;
  checks: VerificationCheck[];
  passed: boolean;
  failures: string[];
  verified_at: string;
  sample_readback_rows: number;
}

export interface VerifyOptions {
  connection: DuckConnection;
  store: ObjectStore;
  manifest: ArchiveManifestV1;
  /**
   * A bounded, deterministically ordered sample of the *source* rows, in the
   * same order the export used. Supplied by the caller because only the caller
   * knows how to reach the source; verification stays independent of how that
   * happened. `null` means the source could not be read, which is not a pass.
   */
  sourceSample: (limit: number) => Promise<Array<Record<string, unknown>> | null>;
  sampleSize?: number;
  /** When supplied, the downloaded copy is kept here instead of a temp dir. */
  workDir?: string;
  now?: () => Date;
}

function stableRowText(row: Record<string, unknown>): string {
  const keys = Object.keys(row).sort();
  return JSON.stringify(keys.map((key) => [key, row[key] ?? null]));
}

/**
 * Compare two row samples position by position. A length disagreement is itself
 * a disagreement -- "the first 50 of 100 matched" is not a pass.
 */
export function compareSamples(
  source: Array<Record<string, unknown>>,
  archive: Array<Record<string, unknown>>,
): { match: boolean; firstMismatchIndex: number; reason: string } {
  if (source.length !== archive.length) {
    return {
      match: false,
      firstMismatchIndex: Math.min(source.length, archive.length),
      reason: `sample sizes differ: source ${source.length} vs archive ${archive.length}`,
    };
  }
  for (let index = 0; index < source.length; index += 1) {
    if (stableRowText(source[index]) !== stableRowText(archive[index])) {
      return { match: false, firstMismatchIndex: index, reason: `row ${index} differs` };
    }
  }
  return { match: true, firstMismatchIndex: -1, reason: 'sample matches' };
}

export async function verifyArchive(options: VerifyOptions): Promise<VerificationReport> {
  const now = options.now ?? (() => new Date());
  const sampleSize = Math.max(0, Math.trunc(options.sampleSize ?? DEFAULT_SAMPLE_SIZE));
  const manifest = options.manifest;
  const dataKey = manifest.object.data_key;

  const checks: VerificationCheck[] = [];
  const add = (id: string, ok: boolean, detail: string): boolean => {
    checks.push({ id, ok, detail });
    return ok;
  };

  let sampleRowsCompared = 0;
  let ownedWorkDir: string | null = null;

  try {
    const structural = validateManifest(manifest);
    add(
      'manifest_valid',
      structural.length === 0,
      structural.length === 0
        ? 'manifest is structurally valid'
        : `manifest violations: ${structural.map((v) => v.code).join(', ')}`,
    );

    // --- object_exists --------------------------------------------------
    const head = await options.store.head(dataKey);
    const objectExists = add(
      'object_exists',
      head !== null && head.size === manifest.object.byte_size,
      head === null
        ? `no object at ${dataKey}`
        : `object present, ${head.size} bytes (manifest claims ${manifest.object.byte_size})`,
    );

    // --- checksum_verified ----------------------------------------------
    const body = objectExists ? await options.store.get(dataKey) : null;
    const actualChecksum = body === null ? null : sha256Hex(body);
    add(
      'checksum_verified',
      actualChecksum !== null && actualChecksum === manifest.object.checksum_sha256,
      actualChecksum === null
        ? 'object could not be downloaded for checksum verification'
        : actualChecksum === manifest.object.checksum_sha256
          ? `sha256 matches (${actualChecksum.slice(0, 16)}…)`
          : `sha256 mismatch: stored ${actualChecksum.slice(0, 16)}… vs manifest ${manifest.object.checksum_sha256.slice(0, 16)}…`,
    );

    // --- parquet_readable -----------------------------------------------
    let localCopy: string | null = null;
    let archiveRowCount: number | null = null;

    if (body !== null) {
      let workDir = options.workDir;
      if (!workDir) {
        ownedWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-talk-warehouse-verify-'));
        workDir = ownedWorkDir;
      }
      fs.mkdirSync(workDir, { recursive: true });
      localCopy = path.join(workDir, 'archive-under-verification.parquet');
      fs.writeFileSync(localCopy, body);

      try {
        const rows = await options.connection.all(
          `SELECT count(*) AS row_count FROM read_parquet(${quote(localCopy)})`,
        );
        archiveRowCount = Number(rows[0]?.row_count ?? 0);
        add('parquet_readable', true, `parquet opened, ${archiveRowCount} rows`);
      } catch (error) {
        localCopy = null;
        add(
          'parquet_readable',
          false,
          `parquet could not be opened: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else {
      add('parquet_readable', false, 'object body unavailable');
    }

    // --- row_count_match -------------------------------------------------
    add(
      'row_count_match',
      archiveRowCount !== null &&
        archiveRowCount === manifest.export.exported_row_count &&
        manifest.export.exported_row_count === manifest.source.row_count,
      archiveRowCount === null
        ? 'archive row count unavailable'
        : `source ${manifest.source.row_count}, manifest export ${manifest.export.exported_row_count}, archive ${archiveRowCount}`,
    );

    // --- sample_readback_match -------------------------------------------
    // The export wrote rows in a declared ORDER BY, so the archive's file order
    // is the export order. Reading the first N back and comparing them to the
    // source's first N under the same ordering is therefore a position-by-
    // position comparison, not a set comparison that could pass on reordered data.
    if (localCopy === null) {
      add('sample_readback_match', false, 'no readable archive to sample');
    } else {
      const sourceSample = await options.sourceSample(sampleSize);
      if (sourceSample === null) {
        add('sample_readback_match', false, 'source sample unavailable; cannot compare read-back');
      } else {
        const archiveSample = await options.connection.all(
          `SELECT * FROM read_parquet(${quote(localCopy)}) LIMIT ${sampleSize}`,
        );
        const comparison = compareSamples(sourceSample, archiveSample);
        sampleRowsCompared = comparison.match ? sourceSample.length : 0;

        // A non-empty partition that produced an empty sample has not been
        // read back at all. Treating that as a pass is exactly the hole this
        // gate exists to close.
        const sampledSomething = manifest.source.row_count === 0 || sourceSample.length > 0;
        add(
          'sample_readback_match',
          comparison.match && sampledSomething,
          sampledSomething
            ? `${comparison.reason} (${Math.min(sourceSample.length, archiveSample.length)} rows compared)`
            : 'partition is non-empty but the sample read back zero rows',
        );
      }
    }
  } finally {
    if (ownedWorkDir) {
      fs.rmSync(ownedWorkDir, { recursive: true, force: true });
    }
  }

  const failures = checks.filter((check) => !check.ok).map((check) => check.id);
  return {
    data_key: dataKey,
    checks,
    passed: failures.length === 0,
    failures,
    verified_at: now().toISOString(),
    sample_readback_rows: failures.length === 0 ? sampleRowsCompared : 0,
  };
}

/**
 * Fold a verification report into the manifest. This is the only way
 * `verification.passed` ever becomes true, and it stays false unless every
 * individual check in the report passed.
 */
export function applyVerification(
  manifest: ArchiveManifestV1,
  report: VerificationReport,
): ArchiveManifestV1 {
  const ok = (id: string): boolean => report.checks.find((check) => check.id === id)?.ok === true;
  const verification: ManifestVerification = {
    verified_at: report.verified_at,
    object_exists: ok('object_exists'),
    row_count_match: ok('row_count_match'),
    checksum_verified: ok('checksum_verified'),
    parquet_readable: ok('parquet_readable'),
    sample_readback_rows: report.sample_readback_rows,
    sample_readback_match: ok('sample_readback_match'),
    passed: report.passed,
    failures: report.failures,
  };
  return { ...manifest, verification };
}

export interface PruneDecision {
  eligible: boolean;
  reasons: string[];
  /**
   * Always present, always the same sentence. A prune decision is not a
   * recommendation the caller may weigh against convenience.
   */
  policy: string;
}

/**
 * The single question the prune path is allowed to ask. It reads the manifest
 * and nothing else -- not the report, not the exporter's return value, not a
 * caller-supplied "I already checked".
 */
export function decidePrune(manifest: unknown): PruneDecision {
  const { eligible, reasons } = isPruneEligible(manifest);
  return {
    eligible,
    reasons,
    policy:
      'A source row or partition is prune-eligible only when a valid manifest records that the ' +
      'object exists, its checksum verified, the Parquet was readable, the row counts matched, ' +
      'and a bounded sample read back identically. Any mismatch is an archive failure.',
  };
}
