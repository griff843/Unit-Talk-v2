import { createHash } from 'node:crypto';

import {
  LAYOUT_VERSION,
  type ArchiveTarget,
  dataObjectKey,
  domainSlug,
  manifestObjectKey,
  validateTarget,
} from './object-layout.js';

/**
 * The archive manifest is the only artifact a prune is ever allowed to consult.
 *
 * Its whole job is to make one claim checkable after the fact: *this many rows
 * left this relation, became exactly these bytes, and those bytes are still
 * readable at this key.* Everything else in the warehouse is convenience; this
 * is the safety property. Accordingly:
 *
 *   - It is built deterministically (stable key order, no clock-derived id), so
 *     a re-export of an unchanged window produces the same manifest and a retry
 *     is idempotent rather than additive.
 *   - `verification` starts out entirely false. It is never constructed in a
 *     passing state; only `verify-archive.ts` may raise it, and only from
 *     checks it actually ran.
 *   - `isPruneEligible` requires every check to be individually true. There is
 *     no aggregate flag a caller can set on its own.
 */

export const MANIFEST_SCHEMA_VERSION = 1 as const;
export const EXPORTER_VERSION = '1.0.0';

export interface ManifestColumn {
  name: string;
  type: string;
}

export interface ManifestVerification {
  verified_at: string | null;
  object_exists: boolean;
  row_count_match: boolean;
  checksum_verified: boolean;
  parquet_readable: boolean;
  sample_readback_rows: number;
  sample_readback_match: boolean;
  passed: boolean;
  failures: string[];
}

export interface ArchiveManifestV1 {
  schema_version: typeof MANIFEST_SCHEMA_VERSION;
  manifest_id: string;
  layout_version: typeof LAYOUT_VERSION;
  source: {
    relation: string;
    partition: string | null;
    domain: string;
    sport: string | null;
    window: { column: string; start: string; end: string };
    row_count: number;
  };
  object: {
    bucket: string;
    data_key: string;
    manifest_key: string;
    byte_size: number;
    checksum_algorithm: 'sha256';
    checksum_sha256: string;
  };
  export: {
    exported_row_count: number;
    exporter_repo_sha: string;
    exporter_version: string;
    data_schema_version: string;
    columns: ManifestColumn[];
    compression: 'zstd';
    row_group_size: number;
    exported_at: string;
  };
  verification: ManifestVerification;
}

export interface BuildManifestInput {
  target: ArchiveTarget;
  bucket: string;
  part?: string;
  sourceRelation: string;
  sourcePartition?: string | null;
  sourceRowCount: number;
  window: { column: string; start: string; end: string };
  exportedRowCount: number;
  byteSize: number;
  checksumSha256: string;
  columns: ManifestColumn[];
  rowGroupSize: number;
  exporterRepoSha: string;
  exportedAt: string;
}

/**
 * A fingerprint of the exported column set. Two files under the same key with
 * different `data_schema_version` values are not two copies of the same
 * partition, and a reader joining across them would be silently wrong.
 */
export function computeDataSchemaVersion(columns: ManifestColumn[]): string {
  const canonical = columns.map((c) => `${c.name}:${c.type}`).join('\n');
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 32)}`;
}

/** Deterministic in the data key alone -- see the note on idempotency above. */
export function computeManifestId(dataKey: string): string {
  return `m${createHash('sha256').update(dataKey, 'utf8').digest('hex').slice(0, 24)}`;
}

export function emptyVerification(): ManifestVerification {
  return {
    verified_at: null,
    object_exists: false,
    row_count_match: false,
    checksum_verified: false,
    parquet_readable: false,
    sample_readback_rows: 0,
    sample_readback_match: false,
    passed: false,
    failures: ['not_yet_verified'],
  };
}

export function buildManifest(input: BuildManifestInput): ArchiveManifestV1 {
  const target = validateTarget(input.target);
  const dataKey = dataObjectKey(target, input.part);
  const manifestId = computeManifestId(dataKey);

  return {
    schema_version: MANIFEST_SCHEMA_VERSION,
    manifest_id: manifestId,
    layout_version: LAYOUT_VERSION,
    source: {
      relation: input.sourceRelation,
      partition: input.sourcePartition ?? null,
      domain: domainSlug(target),
      sport: 'sport' in target ? target.sport : null,
      window: { ...input.window },
      row_count: input.sourceRowCount,
    },
    object: {
      bucket: input.bucket,
      data_key: dataKey,
      manifest_key: manifestObjectKey(target, manifestId),
      byte_size: input.byteSize,
      checksum_algorithm: 'sha256',
      checksum_sha256: input.checksumSha256,
    },
    export: {
      exported_row_count: input.exportedRowCount,
      exporter_repo_sha: input.exporterRepoSha,
      exporter_version: EXPORTER_VERSION,
      data_schema_version: computeDataSchemaVersion(input.columns),
      columns: input.columns.map((c) => ({ name: c.name, type: c.type })),
      compression: 'zstd',
      row_group_size: input.rowGroupSize,
      exported_at: input.exportedAt,
    },
    verification: emptyVerification(),
  };
}

export interface ManifestViolation {
  code: string;
  message: string;
}

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/**
 * Structural validation. Deliberately strict about the fields a prune decision
 * reads, and deliberately silent about the ones it does not: a manifest that
 * cannot be trusted to answer "were these rows really written" is rejected
 * outright rather than repaired.
 */
export function validateManifest(value: unknown): ManifestViolation[] {
  const violations: ManifestViolation[] = [];
  const push = (code: string, message: string): void => {
    violations.push({ code, message });
  };

  if (typeof value !== 'object' || value === null) {
    return [{ code: 'not_an_object', message: 'manifest must be a JSON object' }];
  }
  const m = value as Partial<ArchiveManifestV1>;

  if (m.schema_version !== MANIFEST_SCHEMA_VERSION) {
    push('bad_schema_version', `schema_version must be ${MANIFEST_SCHEMA_VERSION}`);
  }
  if (m.layout_version !== LAYOUT_VERSION) {
    push('bad_layout_version', `layout_version must be ${LAYOUT_VERSION}`);
  }
  if (typeof m.manifest_id !== 'string' || m.manifest_id.length === 0) {
    push('missing_manifest_id', 'manifest_id is required');
  }

  const source = m.source;
  if (typeof source !== 'object' || source === null) {
    push('missing_source', 'source is required');
  } else {
    if (typeof source.relation !== 'string' || source.relation.length === 0) {
      push('missing_source_relation', 'source.relation is required');
    }
    if (!Number.isInteger(source.row_count) || (source.row_count as number) < 0) {
      push('bad_source_row_count', 'source.row_count must be a non-negative integer');
    }
    const w = source.window;
    if (
      typeof w !== 'object' ||
      w === null ||
      typeof w.column !== 'string' ||
      typeof w.start !== 'string' ||
      typeof w.end !== 'string'
    ) {
      push('bad_window', 'source.window must carry column, start and end');
    } else if (!(w.start < w.end)) {
      push('empty_window', 'source.window must be half-open with start < end');
    }
  }

  const object = m.object;
  if (typeof object !== 'object' || object === null) {
    push('missing_object', 'object is required');
  } else {
    if (typeof object.bucket !== 'string' || object.bucket.length === 0) {
      push('missing_bucket', 'object.bucket is required');
    }
    if (typeof object.data_key !== 'string' || !object.data_key.endsWith('.parquet')) {
      push('bad_data_key', 'object.data_key must be a .parquet key');
    }
    if (typeof object.manifest_key !== 'string' || !object.manifest_key.startsWith('manifests/')) {
      push('bad_manifest_key', 'object.manifest_key must live under manifests/');
    }
    if (!Number.isInteger(object.byte_size) || (object.byte_size as number) <= 0) {
      push('bad_byte_size', 'object.byte_size must be a positive integer');
    }
    if (object.checksum_algorithm !== 'sha256') {
      push('bad_checksum_algorithm', 'object.checksum_algorithm must be sha256');
    }
    if (typeof object.checksum_sha256 !== 'string' || !SHA256_HEX_RE.test(object.checksum_sha256)) {
      push('bad_checksum', 'object.checksum_sha256 must be 64 lowercase hex characters');
    }
  }

  const exp = m.export;
  if (typeof exp !== 'object' || exp === null) {
    push('missing_export', 'export is required');
  } else {
    if (!Number.isInteger(exp.exported_row_count) || (exp.exported_row_count as number) < 0) {
      push('bad_exported_row_count', 'export.exported_row_count must be a non-negative integer');
    }
    if (typeof exp.exporter_repo_sha !== 'string' || exp.exporter_repo_sha.length < 7) {
      push('missing_exporter_sha', 'export.exporter_repo_sha is required');
    }
    if (exp.compression !== 'zstd') {
      push('bad_compression', 'export.compression must be zstd');
    }
    if (!Array.isArray(exp.columns) || exp.columns.length === 0) {
      push('missing_columns', 'export.columns must be a non-empty array');
    }
    if (typeof exp.data_schema_version !== 'string' || exp.data_schema_version.length === 0) {
      push('missing_data_schema_version', 'export.data_schema_version is required');
    }
    if (typeof exp.exported_at !== 'string' || Number.isNaN(Date.parse(exp.exported_at))) {
      push('bad_exported_at', 'export.exported_at must be an ISO timestamp');
    }
  }

  const v = m.verification;
  if (typeof v !== 'object' || v === null) {
    push('missing_verification', 'verification is required');
  } else if (typeof v.passed !== 'boolean') {
    push('bad_verification_passed', 'verification.passed must be a boolean');
  }

  return violations;
}

/**
 * The prune gate. Every condition is checked here, from the manifest's own
 * recorded values -- never from a caller's assertion that it verified something.
 *
 * `row_count_match` being true is not enough on its own: the counts it claims to
 * have matched are re-compared here, so a manifest hand-edited to flip one
 * boolean still cannot open the gate.
 */
export function isPruneEligible(manifest: unknown): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const violations = validateManifest(manifest);
  if (violations.length > 0) {
    return { eligible: false, reasons: violations.map((v) => `invalid_manifest:${v.code}`) };
  }
  const m = manifest as ArchiveManifestV1;
  const v = m.verification;

  if (!v.passed) reasons.push('verification_not_passed');
  if (!v.object_exists) reasons.push('object_missing');
  if (!v.row_count_match) reasons.push('row_count_mismatch');
  if (!v.checksum_verified) reasons.push('checksum_unverified');
  if (!v.parquet_readable) reasons.push('parquet_unreadable');
  if (!v.sample_readback_match) reasons.push('sample_readback_mismatch');
  if (v.sample_readback_rows <= 0 && m.source.row_count > 0) {
    reasons.push('no_sample_readback_performed');
  }
  if (v.verified_at === null) reasons.push('not_verified');
  if (m.source.row_count !== m.export.exported_row_count) reasons.push('counts_disagree');
  if (Array.isArray(v.failures) && v.failures.length > 0) {
    reasons.push(...v.failures.map((f) => `recorded_failure:${f}`));
  }

  return { eligible: reasons.length === 0, reasons };
}

/**
 * Stable serialization. Key order is fixed by construction above, so
 * `JSON.stringify` with two-space indentation is byte-deterministic for a given
 * manifest -- which is what lets an idempotent re-run recognise "already done".
 */
export function serializeManifest(manifest: ArchiveManifestV1): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function parseManifest(text: string): ArchiveManifestV1 {
  const parsed: unknown = JSON.parse(text);
  const violations = validateManifest(parsed);
  if (violations.length > 0) {
    throw new Error(
      `Invalid archive manifest: ${violations.map((v) => `${v.code} (${v.message})`).join('; ')}`,
    );
  }
  return parsed as ArchiveManifestV1;
}
