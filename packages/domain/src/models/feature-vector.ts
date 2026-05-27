import { createHash } from 'node:crypto';

// Immutable, versioned feature schema — append-only once registered
export interface FeatureVectorSchema {
  readonly name: string;
  readonly version: string;
  readonly fields: readonly string[];
  readonly registered_at: string;
}

// A named, versioned, replay-safe snapshot of model input features
export interface FeatureVector {
  readonly schema_name: string;
  readonly schema_version: string;
  readonly fields: Readonly<Record<string, number>>;
  readonly hash: string;
}

export type CreateFeatureVectorResult =
  | { ok: true; vector: FeatureVector }
  | { ok: false; reason: string };

// Append-only registry for versioned feature schemas
export class FeatureVectorSchemaRegistry {
  private readonly _schemas = new Map<string, FeatureVectorSchema>();

  register(schema: Omit<FeatureVectorSchema, 'registered_at'>): void {
    const key = schemaKey(schema.name, schema.version);
    if (this._schemas.has(key)) {
      throw new Error(
        `Schema ${key} is already registered and immutable. Create a new version instead.`
      );
    }
    this._schemas.set(key, { ...schema, registered_at: new Date().toISOString() });
  }

  get(name: string, version: string): FeatureVectorSchema | null {
    return this._schemas.get(schemaKey(name, version)) ?? null;
  }

  list(): FeatureVectorSchema[] {
    return Array.from(this._schemas.values());
  }
}

// Fail-closed: throws on unknown schema or missing required fields.
// Deterministic: same schema + fields → same hash.
export function createFeatureVector(
  registry: FeatureVectorSchemaRegistry,
  schemaName: string,
  schemaVersion: string,
  rawFields: Readonly<Record<string, number>>
): CreateFeatureVectorResult {
  const schema = registry.get(schemaName, schemaVersion);
  if (schema === null) {
    return { ok: false, reason: `Unknown schema: ${schemaKey(schemaName, schemaVersion)}` };
  }

  const missing = schema.fields.filter((f) => !(f in rawFields));
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Missing required features for ${schemaKey(schemaName, schemaVersion)}: ${missing.join(', ')}`,
    };
  }

  // Extract only declared fields — extra inputs are silently dropped
  const declared: Record<string, number> = {};
  for (const field of schema.fields) {
    declared[field] = rawFields[field] as number;
  }

  const hash = hashFeatureVector(schemaName, schemaVersion, declared);
  return {
    ok: true,
    vector: { schema_name: schemaName, schema_version: schemaVersion, fields: declared, hash },
  };
}

function schemaKey(name: string, version: string): string {
  return `${name}@${version}`;
}

// Deterministic SHA-256 over schema identity + sorted field entries
function hashFeatureVector(
  schemaName: string,
  schemaVersion: string,
  fields: Record<string, number>
): string {
  const sortedEntries = Object.keys(fields)
    .sort()
    .map((k) => [k, fields[k]] as [string, number]);
  const canonical = JSON.stringify({
    schema: schemaKey(schemaName, schemaVersion),
    fields: sortedEntries,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
