/**
 * Durable object layout for the Unit Talk historical-data warehouse.
 *
 * Every archived object's key is derived here and nowhere else. The layout is
 * the one thing an archive cannot change later without orphaning everything
 * already written, so this module is deliberately pure, total, and fail-closed:
 * an unvalidated token never reaches a key. That is also the path-traversal
 * boundary -- a `sport` of `../../etc` must be refused, not escaped.
 *
 * Layout (LAYOUT_VERSION 1):
 *
 *   raw/{provider}/{sport}/{season}/{date}/{part}.parquet
 *   canonical/{domain}/{sport}/{season}/{date}/{part}.parquet
 *   features/{feature_version}/{sport}/{part}.parquet
 *   training/{dataset_version}/{part}.parquet
 *   models/{model_version}/{artifact}
 *   manifests/{domain}/{date}/{manifest_id}.json
 *
 * `canonical` domains are fixed (markets, player_stats, team_stats, results,
 * closing_lines) rather than free text, because a typo'd domain is not a
 * recoverable mistake once a year of partitions has been written under it.
 */

export const LAYOUT_VERSION = 1 as const;

export const CANONICAL_DOMAINS = [
  'markets',
  'player_stats',
  'team_stats',
  'results',
  'closing_lines',
] as const;

export type CanonicalDomain = (typeof CANONICAL_DOMAINS)[number];

export type ArchiveTarget =
  | { kind: 'raw'; provider: string; sport: string; season: string; date: string }
  | { kind: 'canonical'; domain: CanonicalDomain; sport: string; season: string; date: string }
  | { kind: 'features'; featureVersion: string; sport: string }
  | { kind: 'training'; datasetVersion: string }
  | { kind: 'models'; modelVersion: string };

/**
 * Slug grammar for every path token that is not a date or a season. Lowercase
 * only: object stores are case-sensitive, and `NFL/` and `nfl/` silently
 * becoming two archives is the exact class of split-brain this layout exists to
 * prevent.
 */
const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;
const SEASON_RE = /^\d{4}(?:-\d{2})?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PART_RE = /^[a-z0-9][a-z0-9_-]*$/;

export class ObjectLayoutError extends Error {
  readonly code = 'invalid_object_layout_token';
  constructor(message: string) {
    super(message);
    this.name = 'ObjectLayoutError';
  }
}

function requireSlug(label: string, value: unknown): string {
  if (typeof value !== 'string' || !SLUG_RE.test(value)) {
    throw new ObjectLayoutError(
      `${label} must match ${SLUG_RE.source} (lowercase slug); received ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function requireSeason(value: unknown): string {
  if (typeof value !== 'string' || !SEASON_RE.test(value)) {
    throw new ObjectLayoutError(
      `season must be YYYY or YYYY-YY; received ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * A real calendar date, not merely a ten-character string. `2026-02-30` matches
 * the shape and is not a day; admitting it would create a partition that no
 * source window can ever fill.
 */
export function requireIsoDate(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ObjectLayoutError(`date must be a string; received ${JSON.stringify(value)}`);
  }
  const match = DATE_RE.exec(value);
  if (!match) {
    throw new ObjectLayoutError(`date must be YYYY-MM-DD; received ${JSON.stringify(value)}`);
  }
  const [, y, m, d] = match;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== Number(y) ||
    parsed.getUTCMonth() + 1 !== Number(m) ||
    parsed.getUTCDate() !== Number(d)
  ) {
    throw new ObjectLayoutError(`date is not a real calendar day: ${value}`);
  }
  return value;
}

function requirePart(value: unknown): string {
  if (typeof value !== 'string' || !PART_RE.test(value)) {
    throw new ObjectLayoutError(
      `part name must match ${PART_RE.source}; received ${JSON.stringify(value)}`,
    );
  }
  return value;
}

export function isCanonicalDomain(value: unknown): value is CanonicalDomain {
  return typeof value === 'string' && (CANONICAL_DOMAINS as readonly string[]).includes(value);
}

/** Validates a target and returns a normalized copy. Throws on any bad token. */
export function validateTarget(target: ArchiveTarget): ArchiveTarget {
  switch (target.kind) {
    case 'raw':
      return {
        kind: 'raw',
        provider: requireSlug('provider', target.provider),
        sport: requireSlug('sport', target.sport),
        season: requireSeason(target.season),
        date: requireIsoDate(target.date),
      };
    case 'canonical':
      if (!isCanonicalDomain(target.domain)) {
        throw new ObjectLayoutError(
          `canonical domain must be one of ${CANONICAL_DOMAINS.join(', ')}; received ${JSON.stringify(target.domain)}`,
        );
      }
      return {
        kind: 'canonical',
        domain: target.domain,
        sport: requireSlug('sport', target.sport),
        season: requireSeason(target.season),
        date: requireIsoDate(target.date),
      };
    case 'features':
      return {
        kind: 'features',
        featureVersion: requireSlug('feature_version', target.featureVersion),
        sport: requireSlug('sport', target.sport),
      };
    case 'training':
      return {
        kind: 'training',
        datasetVersion: requireSlug('dataset_version', target.datasetVersion),
      };
    case 'models':
      return { kind: 'models', modelVersion: requireSlug('model_version', target.modelVersion) };
    default: {
      const exhaustive: never = target;
      throw new ObjectLayoutError(`unknown archive target kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * The domain slug a target is filed under in `manifests/{domain}/...`, and the
 * value recorded as `source.domain` in the manifest.
 */
export function domainSlug(target: ArchiveTarget): string {
  const t = validateTarget(target);
  switch (t.kind) {
    case 'raw':
      return `raw_${t.provider}`;
    case 'canonical':
      return t.domain;
    case 'features':
      return 'features';
    case 'training':
      return 'training';
    case 'models':
      return 'models';
    default: {
      const exhaustive: never = t;
      throw new ObjectLayoutError(String(exhaustive));
    }
  }
}

/** Directory prefix (no trailing slash) holding a target's data objects. */
export function dataPrefix(target: ArchiveTarget): string {
  const t = validateTarget(target);
  switch (t.kind) {
    case 'raw':
      return `raw/${t.provider}/${t.sport}/${t.season}/${t.date}`;
    case 'canonical':
      return `canonical/${t.domain}/${t.sport}/${t.season}/${t.date}`;
    case 'features':
      return `features/${t.featureVersion}/${t.sport}`;
    case 'training':
      return `training/${t.datasetVersion}`;
    case 'models':
      return `models/${t.modelVersion}`;
    default: {
      const exhaustive: never = t;
      throw new ObjectLayoutError(String(exhaustive));
    }
  }
}

export function dataObjectKey(target: ArchiveTarget, part = 'part-0000'): string {
  return `${dataPrefix(target)}/${requirePart(part)}.parquet`;
}

/**
 * Manifest key. Deterministic in the target alone, so a retry of the same
 * window addresses the same manifest object rather than accumulating one
 * manifest per attempt -- that determinism is what makes the conveyor
 * idempotent.
 */
export function manifestObjectKey(target: ArchiveTarget, manifestId: string): string {
  const t = validateTarget(target);
  const date = 'date' in t ? t.date : 'undated';
  return `manifests/${domainSlug(t)}/${date}/${requireSlug('manifest_id', manifestId)}.json`;
}

export interface ParsedDataKey {
  target: ArchiveTarget;
  part: string;
}

/**
 * Inverse of {@link dataObjectKey}. Round-tripping is asserted in the tests:
 * a layout you can write but not parse is a layout you cannot audit.
 */
export function parseDataObjectKey(key: string): ParsedDataKey | null {
  if (typeof key !== 'string' || !key.endsWith('.parquet')) {
    return null;
  }
  const segments = key.slice(0, -'.parquet'.length).split('/');
  try {
    if (segments[0] === 'raw' && segments.length === 6) {
      const [, provider, sport, season, date, part] = segments;
      return {
        target: validateTarget({ kind: 'raw', provider, sport, season, date }),
        part: requirePart(part),
      };
    }
    if (segments[0] === 'canonical' && segments.length === 6) {
      const [, domain, sport, season, date, part] = segments;
      if (!isCanonicalDomain(domain)) {
        return null;
      }
      return {
        target: validateTarget({ kind: 'canonical', domain, sport, season, date }),
        part: requirePart(part),
      };
    }
    if (segments[0] === 'features' && segments.length === 4) {
      const [, featureVersion, sport, part] = segments;
      return {
        target: validateTarget({ kind: 'features', featureVersion, sport }),
        part: requirePart(part),
      };
    }
    if (segments[0] === 'training' && segments.length === 3) {
      const [, datasetVersion, part] = segments;
      return {
        target: validateTarget({ kind: 'training', datasetVersion }),
        part: requirePart(part),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * A DuckDB-readable glob covering every object under a prefix. Used by the
 * read path so an analyst never has to know how many part files a window
 * produced.
 */
export function readGlob(bucketUri: string, prefix: string): string {
  const base = bucketUri.replace(/\/+$/, '');
  const cleaned = prefix.replace(/^\/+|\/+$/g, '');
  return cleaned.length > 0 ? `${base}/${cleaned}/**/*.parquet` : `${base}/**/*.parquet`;
}
