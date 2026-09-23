import fs from 'node:fs';
import path from 'node:path';

import {
  type DuckConnection,
  loadExtension,
  quote,
  quoteIdent,
} from './duckdb.js';
import { sha256File } from './object-store.js';
import type { ManifestColumn } from './manifest.js';

/**
 * Bounded historical export.
 *
 * Every export is a *window*, never a table. There is no code path here that
 * reads a relation without a half-open predicate, and there is no path that
 * pulls rows into JavaScript: DuckDB's `COPY (...) TO` streams from the
 * Postgres cursor straight to the Parquet writer, so peak memory is a row
 * group, not a partition. That is the difference between exporting an 8-million
 * row relation and OOM-ing the runner on it.
 *
 * `MAX_WINDOW_ROWS` is a second, cruder guard: if a window turns out to hold
 * more rows than a single object should, the export refuses and says to narrow
 * the window rather than producing one object nobody can re-verify cheaply.
 */

export const DEFAULT_ROW_GROUP_SIZE = 122_880;
export const MAX_WINDOW_ROWS = 20_000_000;

const RELATION_RE = /^(?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*$/;
const COLUMN_RE = /^[a-z_][a-z0-9_]*$/;

export interface WindowSpec {
  /** Timestamp column the window is taken on. */
  column: string;
  /** Inclusive lower bound, ISO-8601. */
  start: string;
  /** Exclusive upper bound, ISO-8601. */
  end: string;
}

export interface SourceSpec {
  /** `schema.relation`, or a bare relation resolved in the attached search path. */
  relation: string;
  window: WindowSpec;
  /** Optional equality filter, e.g. `sport_key = 'nfl'`. */
  filterColumn?: string | null;
  filterValue?: string | null;
  /** Deterministic ordering. Required: an unordered export is not reproducible. */
  orderBy: string[];
}

export class ExportError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'ExportError';
  }
}

function requireRelation(relation: string): string {
  if (typeof relation !== 'string' || !RELATION_RE.test(relation)) {
    throw new ExportError(
      'invalid_relation',
      `source relation must be [schema.]relation in lowercase; received ${JSON.stringify(relation)}`,
    );
  }
  return relation
    .split('.')
    .map((part) => quoteIdent(part))
    .join('.');
}

function requireColumn(label: string, column: string): string {
  if (typeof column !== 'string' || !COLUMN_RE.test(column)) {
    throw new ExportError(
      'invalid_column',
      `${label} must be a lowercase identifier; received ${JSON.stringify(column)}`,
    );
  }
  return column;
}

function requireTimestamp(label: string, value: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new ExportError(
      'invalid_window_bound',
      `${label} must be an ISO-8601 timestamp; received ${JSON.stringify(value)}`,
    );
  }
  return value;
}

export function validateSource(source: SourceSpec): SourceSpec {
  requireRelation(source.relation);
  requireColumn('window.column', source.window.column);
  requireTimestamp('window.start', source.window.start);
  requireTimestamp('window.end', source.window.end);
  if (!(Date.parse(source.window.start) < Date.parse(source.window.end))) {
    throw new ExportError(
      'empty_window',
      `window must be half-open with start < end; received ${source.window.start} .. ${source.window.end}`,
    );
  }
  if (!Array.isArray(source.orderBy) || source.orderBy.length === 0) {
    throw new ExportError(
      'missing_order_by',
      'orderBy is required: an export without a deterministic ordering cannot be reproduced or sampled',
    );
  }
  source.orderBy.forEach((c, i) => requireColumn(`orderBy[${i}]`, c));
  if (source.filterColumn) {
    requireColumn('filterColumn', source.filterColumn);
    if (typeof source.filterValue !== 'string') {
      throw new ExportError(
        'missing_filter_value',
        'filterColumn was supplied without a filterValue',
      );
    }
  }
  return source;
}

/** The WHERE clause. Bound literals are quoted here and nowhere else. */
export function buildWhereClause(source: SourceSpec): string {
  validateSource(source);
  const column = quoteIdent(source.window.column);
  const clauses = [
    `${column} >= ${quote(source.window.start)}::TIMESTAMPTZ`,
    `${column} < ${quote(source.window.end)}::TIMESTAMPTZ`,
  ];
  if (source.filterColumn) {
    clauses.push(`${quoteIdent(source.filterColumn)} = ${quote(source.filterValue as string)}`);
  }
  return clauses.join(' AND ');
}

export function buildSelectSql(source: SourceSpec, relationExpr?: string): string {
  const relation = relationExpr ?? requireRelation(source.relation);
  const order = source.orderBy.map((c) => quoteIdent(c)).join(', ');
  return `SELECT * FROM ${relation} WHERE ${buildWhereClause(source)} ORDER BY ${order}`;
}

export function buildCountSql(source: SourceSpec, relationExpr?: string): string {
  const relation = relationExpr ?? requireRelation(source.relation);
  return `SELECT count(*) AS row_count FROM ${relation} WHERE ${buildWhereClause(source)}`;
}

export function buildCopySql(
  selectSql: string,
  destinationPath: string,
  rowGroupSize = DEFAULT_ROW_GROUP_SIZE,
): string {
  if (!Number.isInteger(rowGroupSize) || rowGroupSize <= 0) {
    throw new ExportError('invalid_row_group_size', 'rowGroupSize must be a positive integer');
  }
  return (
    `COPY (${selectSql}) TO ${quote(destinationPath)} ` +
    `(FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE ${rowGroupSize})`
  );
}

export interface AttachedSource {
  /** SQL expression naming the relation inside DuckDB, already quoted. */
  relationExpr: string;
  detach: () => Promise<void>;
}

/**
 * Attach the operational Postgres read-only. `READ_ONLY` is not decoration: it
 * is what makes it structurally impossible for an exporter bug to write to the
 * hot database it is draining.
 */
export async function attachPostgres(
  connection: DuckConnection,
  dsn: string,
  alias = 'src',
): Promise<AttachedSource> {
  const extension = await loadExtension(connection, 'postgres');
  if (!extension.loaded) {
    throw new ExportError(
      'postgres_extension_unavailable',
      `DuckDB's postgres extension could not be loaded: ${extension.error ?? 'unknown error'}`,
    );
  }
  await connection.run(`ATTACH ${quote(dsn)} AS ${quoteIdent(alias)} (TYPE postgres, READ_ONLY)`);
  return {
    relationExpr: quoteIdent(alias),
    detach: async () => {
      await connection.run(`DETACH ${quoteIdent(alias)}`);
    },
  };
}

export function qualifyAttached(alias: string, relation: string): string {
  const parts = relation.split('.');
  const qualified = parts.length === 2 ? parts : ['public', parts[0]];
  return [alias, ...qualified].map((p) => quoteIdent(p)).join('.');
}

export interface ExportResult {
  destinationPath: string;
  sourceRowCount: number;
  exportedRowCount: number;
  byteSize: number;
  checksumSha256: string;
  columns: ManifestColumn[];
  rowGroupSize: number;
}

export interface ExportOptions {
  connection: DuckConnection;
  source: SourceSpec;
  /** Relation expression inside DuckDB (attached Postgres, or a local table). */
  relationExpr?: string;
  destinationPath: string;
  rowGroupSize?: number;
  maxWindowRows?: number;
}

/**
 * Export one window to a local Parquet file and measure it.
 *
 * The source count is taken *before* the copy and the exported count *after*,
 * from the written file rather than from the copy's own report. Those are two
 * independent observations of the same quantity; comparing the writer's claim
 * against itself would prove nothing.
 */
export async function exportWindowToParquet(options: ExportOptions): Promise<ExportResult> {
  const source = validateSource(options.source);
  const rowGroupSize = options.rowGroupSize ?? DEFAULT_ROW_GROUP_SIZE;
  const maxRows = options.maxWindowRows ?? MAX_WINDOW_ROWS;
  const relationExpr = options.relationExpr ?? undefined;

  const countRows = await options.connection.all(buildCountSql(source, relationExpr));
  const sourceRowCount = Number(countRows[0]?.row_count ?? 0);

  if (sourceRowCount > maxRows) {
    throw new ExportError(
      'window_too_large',
      `window holds ${sourceRowCount} rows, above the ${maxRows}-row bound for a single object. ` +
        'Narrow the window (shorter date range, or partition by sport) and export the pieces.',
    );
  }

  fs.mkdirSync(path.dirname(options.destinationPath), { recursive: true });
  if (fs.existsSync(options.destinationPath)) {
    fs.rmSync(options.destinationPath);
  }

  await options.connection.run(
    buildCopySql(buildSelectSql(source, relationExpr), options.destinationPath, rowGroupSize),
  );

  if (!fs.existsSync(options.destinationPath)) {
    throw new ExportError(
      'export_produced_no_object',
      `COPY completed but wrote no file at ${options.destinationPath}`,
    );
  }

  const exportedRows = await options.connection.all(
    `SELECT count(*) AS row_count FROM read_parquet(${quote(options.destinationPath)})`,
  );
  const exportedRowCount = Number(exportedRows[0]?.row_count ?? 0);

  const described = await options.connection.all(
    `DESCRIBE SELECT * FROM read_parquet(${quote(options.destinationPath)})`,
  );
  const columns: ManifestColumn[] = described.map((row) => ({
    name: String(row.column_name ?? ''),
    type: String(row.column_type ?? ''),
  }));

  const { sha256, size } = sha256File(options.destinationPath);

  return {
    destinationPath: options.destinationPath,
    sourceRowCount,
    exportedRowCount,
    byteSize: size,
    checksumSha256: sha256,
    columns,
    rowGroupSize,
  };
}
