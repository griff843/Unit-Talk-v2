import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  type ObjectStoreConfig,
  resolveObjectStoreConfig,
  WAREHOUSE_ENV_KEYS,
} from './config.js';

/**
 * The object-storage boundary.
 *
 * Two implementations satisfy one interface: `S3ObjectStore` for Hetzner Object
 * Storage (or any S3-compatible endpoint), and `LocalObjectStore` for tests and
 * for `--dry-run`. They are interchangeable on purpose -- every fail-closed
 * verification test in this lane runs against the local store, so the
 * verification logic is proven without a bucket, and the S3 implementation is
 * then the only thing left needing live credentials.
 *
 * Writes are whole-object PUTs. That matters for retry safety: a single-part PUT
 * is atomic at the object level, so a conveyor run interrupted mid-upload leaves
 * either the previous object or no object -- never a truncated one that a later
 * checksum would have to catch.
 */

export interface ObjectHead {
  key: string;
  size: number;
}

export interface ObjectStore {
  readonly bucket: string;
  describe(): { kind: 's3' | 'local'; bucket: string; endpoint: string | null };
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  head(key: string): Promise<ObjectHead | null>;
  get(key: string): Promise<Buffer | null>;
  list(prefix: string): Promise<string[]>;
  /** A URI the DuckDB read path can glob over. */
  uriFor(key: string): string;
  /** The base URI of the bucket, without a trailing slash. */
  baseUri(): string;
}

export function sha256Hex(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

export function sha256File(filePath: string): { sha256: string; size: number } {
  const body = fs.readFileSync(filePath);
  return { sha256: sha256Hex(body), size: body.byteLength };
}

/** Rejects keys that could escape the bucket prefix or address a parent path. */
function assertSafeKey(key: string): string {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('object key must be a non-empty string');
  }
  if (key.startsWith('/') || key.includes('..') || key.includes('//') || /\\/.test(key)) {
    throw new Error(`unsafe object key: ${JSON.stringify(key)}`);
  }
  return key;
}

export class LocalObjectStore implements ObjectStore {
  readonly bucket: string;
  private readonly root: string;

  constructor(root: string, bucket = 'local') {
    this.root = path.resolve(root);
    this.bucket = bucket;
  }

  describe(): { kind: 'local'; bucket: string; endpoint: string | null } {
    return { kind: 'local', bucket: this.bucket, endpoint: null };
  }

  private pathFor(key: string): string {
    return path.join(this.root, assertSafeKey(key));
  }

  // `contentType` is part of the `ObjectStore` contract and is ignored here: a
  // directory has nowhere to record it. Accepting it keeps every caller's call
  // shape identical across the local and S3 stores, so a test written against
  // one is a test of the other.
  async put(key: string, body: Buffer, _contentType?: string): Promise<void> {
    const target = this.pathFor(key);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // Write-then-rename so a local run has the same atomicity story as a
    // single-part S3 PUT; a partially written file is never observable at the key.
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, target);
  }

  async head(key: string): Promise<ObjectHead | null> {
    const target = this.pathFor(key);
    if (!fs.existsSync(target)) {
      return null;
    }
    return { key, size: fs.statSync(target).size };
  }

  async get(key: string): Promise<Buffer | null> {
    const target = this.pathFor(key);
    return fs.existsSync(target) ? fs.readFileSync(target) : null;
  }

  async list(prefix: string): Promise<string[]> {
    const base = path.join(this.root, prefix.replace(/^\/+/, ''));
    const out: string[] = [];
    const walk = (dir: string): void => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else out.push(path.relative(this.root, full).split(path.sep).join('/'));
      }
    };
    walk(base);
    return out.sort();
  }

  uriFor(key: string): string {
    return this.pathFor(key);
  }

  baseUri(): string {
    return this.root;
  }
}

interface S3ClientLike {
  send(command: unknown): Promise<unknown>;
}

/**
 * S3-compatible store. The AWS SDK is imported lazily so that every pure test
 * in this lane -- layout, manifest, verification, conveyor planning -- runs
 * without loading it, and so a checkout with no warehouse credentials can still
 * run `pnpm test`.
 */
export class S3ObjectStore implements ObjectStore {
  readonly bucket: string;
  private readonly config: ObjectStoreConfig;
  private client: S3ClientLike | null = null;
  private commands: Record<string, new (input: unknown) => unknown> | null = null;

  constructor(config: ObjectStoreConfig) {
    this.config = config;
    this.bucket = config.bucket;
  }

  describe(): { kind: 's3'; bucket: string; endpoint: string } {
    return { kind: 's3', bucket: this.bucket, endpoint: this.config.endpoint };
  }

  private async ensureClient(): Promise<{
    client: S3ClientLike;
    commands: Record<string, new (input: unknown) => unknown>;
  }> {
    if (this.client && this.commands) {
      return { client: this.client, commands: this.commands };
    }
    const mod = (await import('@aws-sdk/client-s3')) as unknown as Record<
      string,
      new (input: unknown) => unknown
    >;
    const S3Client = mod.S3Client;
    this.client = new S3Client({
      endpoint: this.config.endpoint,
      region: this.config.region,
      forcePathStyle: this.config.forcePathStyle,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
    }) as unknown as S3ClientLike;
    this.commands = mod;
    return { client: this.client, commands: this.commands };
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    const { client, commands } = await this.ensureClient();
    await client.send(
      new commands.PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Let the service reject a corrupted transfer rather than discovering
        // it later during checksum verification.
        ChecksumSHA256: createHash('sha256').update(body).digest('base64'),
      }),
    );
  }

  async head(key: string): Promise<ObjectHead | null> {
    assertSafeKey(key);
    const { client, commands } = await this.ensureClient();
    try {
      const response = (await client.send(
        new commands.HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      )) as { ContentLength?: number };
      return { key, size: Number(response.ContentLength ?? 0) };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async get(key: string): Promise<Buffer | null> {
    assertSafeKey(key);
    const { client, commands } = await this.ensureClient();
    try {
      const response = (await client.send(
        new commands.GetObjectCommand({ Bucket: this.bucket, Key: key }),
      )) as { Body?: { transformToByteArray(): Promise<Uint8Array> } };
      if (!response.Body) return null;
      return Buffer.from(await response.Body.transformToByteArray());
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const { client, commands } = await this.ensureClient();
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const response = (await client.send(
        new commands.ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      )) as {
        Contents?: Array<{ Key?: string }>;
        NextContinuationToken?: string;
        IsTruncated?: boolean;
      };
      for (const entry of response.Contents ?? []) {
        if (entry.Key) keys.push(entry.Key);
      }
      token = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (token);
    return keys.sort();
  }

  uriFor(key: string): string {
    return `s3://${this.bucket}/${assertSafeKey(key)}`;
  }

  baseUri(): string {
    return `s3://${this.bucket}`;
  }
}

function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

export type StoreResolution =
  | { ok: true; store: ObjectStore }
  | { ok: false; code: string; missing: string[]; message: string };

/**
 * Resolve the store the current environment is configured for. A local root is
 * honoured only when it is set explicitly -- there is no implicit fallback from
 * "S3 not configured" to "write it to a directory", because that fallback is
 * precisely how an archive comes to exist nowhere while a manifest says it does.
 */
export function createObjectStoreFromEnv(env: NodeJS.ProcessEnv = process.env): StoreResolution {
  const localRoot = env[WAREHOUSE_ENV_KEYS.localRoot];
  if (typeof localRoot === 'string' && localRoot.trim().length > 0) {
    return { ok: true, store: new LocalObjectStore(localRoot.trim(), 'local-warehouse') };
  }
  const resolved = resolveObjectStoreConfig(env);
  if (!resolved.ok) {
    return {
      ok: false,
      code: resolved.code,
      missing: resolved.missing,
      message: resolved.message,
    };
  }
  return { ok: true, store: new S3ObjectStore(resolved.config) };
}
