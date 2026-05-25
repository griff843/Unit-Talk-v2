import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ROOT,
  emitJson,
  ensureDir,
  getFlag,
  parseArgs,
  relativeToRoot,
  requireIssueId,
} from './shared.js';
import { loadConcurrencyConfig } from './concurrency-config.js';

export type MergeLockStatus = 'held' | 'stale_reclaim_required' | 'released';

export interface MergeLockOwner {
  user: string;
  host: string;
  pid: number;
  session_id: string;
}

export interface MergeLock {
  schema_version: 1;
  issue_id: string;
  branch: string;
  pr: string | null;
  cwd: string;
  reason: string;
  acquired_at: string;
  expires_at: string;
  owner: MergeLockOwner;
  status: MergeLockStatus;
}

export interface MergeLockInput {
  issue_id: string;
  branch: string;
  pr?: string | null;
  cwd: string;
  reason: string;
  owner: MergeLockOwner;
  acquired_at?: string;
  expires_at?: string;
  ttl_ms?: number;
}

export type MergeLockResult =
  | {
      ok: true;
      code: 'merge_lock_acquired' | 'merge_lock_released' | 'merge_lock_reclaimed' | 'merge_lock_held';
      lock: MergeLock;
      lock_path: string;
      message: string;
    }
  | {
      ok: false;
      code:
        | 'merge_lock_missing_required_fields'
        | 'merge_lock_held'
        | 'merge_lock_missing'
        | 'merge_lock_stale_reclaim_required'
        | 'merge_lock_not_stale'
        | 'merge_lock_invalid'
        | 'merge_lock_config_unsupported'
        | 'merge_lock_owner_mismatch';
      lock?: MergeLock;
      lock_path?: string;
      missing_fields?: string[];
      message: string;
    };

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const VALID_STATUSES = new Set<MergeLockStatus>([
  'held',
  'stale_reclaim_required',
  'released',
]);

export const MERGE_LOCK_PATH = path.join(ROOT, '.ops', 'merge-lock.json');

function requireSupportedMergeSerialization(): MergeLockResult | null {
  const max = loadConcurrencyConfig().merge_serialized_max;
  if (max === 1) {
    return null;
  }
  return {
    ok: false,
    code: 'merge_lock_config_unsupported',
    message: `Unsupported merge_serialized_max=${max}. The merge mutex currently enforces exactly one serialized merge at a time.`,
  };
}

export function defaultMergeLockOwner(sessionId = process.env.CODEX_SESSION_ID): MergeLockOwner {
  return {
    user: os.userInfo().username || 'unknown',
    host: os.hostname() || 'unknown',
    pid: process.pid,
    session_id: sessionId?.trim() || `${os.hostname()}:${process.pid}`,
  };
}

export function acquireMergeLock(
  input: Partial<MergeLockInput>,
  options: { lockPath?: string; now?: Date } = {},
): MergeLockResult {
  const lockPath = options.lockPath ?? MERGE_LOCK_PATH;
  const now = options.now ?? new Date();
  const configViolation = requireSupportedMergeSerialization();
  if (configViolation) {
    return configViolation;
  }
  const missingFields = missingInputFields(input);
  if (missingFields.length > 0) {
    return {
      ok: false,
      code: 'merge_lock_missing_required_fields',
      missing_fields: missingFields,
      message: `Missing required merge lock fields: ${missingFields.join(', ')}`,
    };
  }

  const lock = buildLock(input as MergeLockInput, now);
  const existingResult = readMergeLock(lockPath);
  if (!existingResult.ok && existingResult.code !== 'merge_lock_missing') {
    return existingResult;
  }

  if (existingResult.ok) {
    const existing = markExpiredLock(existingResult.lock, now, lockPath);
    if (existing.status === 'held') {
      return {
        ok: false,
        code: 'merge_lock_held',
        lock: existing,
        lock_path: relativePathOrAbsolute(lockPath),
        message: `Merge lock is already held by ${existing.issue_id}`,
      };
    }
    if (existing.status === 'stale_reclaim_required') {
      return {
        ok: false,
        code: 'merge_lock_stale_reclaim_required',
        lock: existing,
        lock_path: relativePathOrAbsolute(lockPath),
        message: `Expired merge lock for ${existing.issue_id} requires explicit reclaim`,
      };
    }

    writeLockAtomic(lockPath, lock);
    return {
      ok: true,
      code: 'merge_lock_acquired',
      lock,
      lock_path: relativePathOrAbsolute(lockPath),
      message: `Merge lock acquired for ${lock.issue_id}`,
    };
  }

  const writeResult = writeNewLockExclusive(lockPath, lock);
  if (!writeResult.ok) {
    return writeResult;
  }

  return {
    ok: true,
    code: 'merge_lock_acquired',
    lock,
    lock_path: relativePathOrAbsolute(lockPath),
    message: `Merge lock acquired for ${lock.issue_id}`,
  };
}

export function releaseMergeLock(
  input: { issue_id: string; branch?: string; force?: boolean },
  options: { lockPath?: string; now?: Date } = {},
): MergeLockResult {
  const lockPath = options.lockPath ?? MERGE_LOCK_PATH;
  const issueId = requireIssueId(input.issue_id);
  const existingResult = readMergeLock(lockPath);
  if (!existingResult.ok) {
    return existingResult;
  }

  const lock = existingResult.lock;
  if (!input.force && (lock.issue_id !== issueId || (input.branch && lock.branch !== input.branch))) {
    return {
      ok: false,
      code: 'merge_lock_owner_mismatch',
      lock,
      lock_path: relativePathOrAbsolute(lockPath),
      message: `Merge lock is held by ${lock.issue_id} on ${lock.branch}`,
    };
  }

  lock.status = 'released';
  lock.expires_at = (options.now ?? new Date()).toISOString();
  writeLockAtomic(lockPath, lock);
  return {
    ok: true,
    code: 'merge_lock_released',
    lock,
    lock_path: relativePathOrAbsolute(lockPath),
    message: `Merge lock released for ${issueId}`,
  };
}

export function reclaimMergeLock(
  input: Partial<MergeLockInput>,
  options: { lockPath?: string; now?: Date } = {},
): MergeLockResult {
  const lockPath = options.lockPath ?? MERGE_LOCK_PATH;
  const now = options.now ?? new Date();
  const existingResult = readMergeLock(lockPath);
  if (!existingResult.ok) {
    return existingResult;
  }

  const existing = markExpiredLock(existingResult.lock, now, lockPath);
  if (existing.status !== 'stale_reclaim_required') {
    return {
      ok: false,
      code: 'merge_lock_not_stale',
      lock: existing,
      lock_path: relativePathOrAbsolute(lockPath),
      message: `Merge lock for ${existing.issue_id} is not stale`,
    };
  }

  const missingFields = missingInputFields(input);
  if (missingFields.length > 0) {
    return {
      ok: false,
      code: 'merge_lock_missing_required_fields',
      missing_fields: missingFields,
      message: `Missing required merge lock fields: ${missingFields.join(', ')}`,
    };
  }

  const lock = buildLock(input as MergeLockInput, now);
  writeLockAtomic(lockPath, lock);
  return {
    ok: true,
    code: 'merge_lock_reclaimed',
    lock,
    lock_path: relativePathOrAbsolute(lockPath),
    message: `Stale merge lock reclaimed for ${lock.issue_id}`,
  };
}

export function requireMergeLockHeld(
  input: { issue_id: string; branch?: string; reason?: string },
  options: { lockPath?: string; now?: Date } = {},
): MergeLockResult {
  const lockPath = options.lockPath ?? MERGE_LOCK_PATH;
  const issueId = requireIssueId(input.issue_id);
  const existingResult = readMergeLock(lockPath);
  if (!existingResult.ok) {
    return existingResult;
  }

  const lock = markExpiredLock(existingResult.lock, options.now ?? new Date(), lockPath);
  if (lock.status === 'stale_reclaim_required') {
    return {
      ok: false,
      code: 'merge_lock_stale_reclaim_required',
      lock,
      lock_path: relativePathOrAbsolute(lockPath),
      message: `Expired merge lock for ${lock.issue_id} requires explicit reclaim`,
    };
  }
  if (lock.status !== 'held') {
    return {
      ok: false,
      code: 'merge_lock_missing',
      lock,
      lock_path: relativePathOrAbsolute(lockPath),
      message: 'Merge lock is not held',
    };
  }
  if (lock.issue_id !== issueId || (input.branch && lock.branch !== input.branch)) {
    return {
      ok: false,
      code: 'merge_lock_owner_mismatch',
      lock,
      lock_path: relativePathOrAbsolute(lockPath),
      message: `Merge lock is held by ${lock.issue_id} on ${lock.branch}`,
    };
  }

  return {
    ok: true,
    code: 'merge_lock_held',
    lock,
    lock_path: relativePathOrAbsolute(lockPath),
    message: `Merge lock held for ${issueId}${input.reason ? ` (${input.reason})` : ''}`,
  };
}

export function readMergeLock(lockPath = MERGE_LOCK_PATH): MergeLockResult {
  if (!fs.existsSync(lockPath)) {
    return {
      ok: false,
      code: 'merge_lock_missing',
      lock_path: relativePathOrAbsolute(lockPath),
      message: 'Merge lock does not exist',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as unknown;
  } catch (error) {
    return {
      ok: false,
      code: 'merge_lock_invalid',
      lock_path: relativePathOrAbsolute(lockPath),
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const errors = validateMergeLock(parsed);
  if (errors.length > 0) {
    return {
      ok: false,
      code: 'merge_lock_invalid',
      lock_path: relativePathOrAbsolute(lockPath),
      message: errors.join('; '),
    };
  }

  return {
    ok: true,
    code: 'merge_lock_held',
    lock: parsed as MergeLock,
    lock_path: relativePathOrAbsolute(lockPath),
    message: 'Merge lock loaded',
  };
}

export function writeLockAtomic(lockPath: string, lock: MergeLock): void {
  const errors = validateMergeLock(lock);
  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }

  ensureDir(path.dirname(lockPath));
  const tempPath = `${lockPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, lockPath);
}

export function validateMergeLock(input: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return ['merge lock must be an object'];
  }

  if (input.schema_version !== 1) errors.push('schema_version must be 1');
  requireString(input, 'issue_id', errors);
  requireString(input, 'branch', errors);
  requireString(input, 'cwd', errors);
  requireString(input, 'reason', errors);
  requireString(input, 'acquired_at', errors);
  requireString(input, 'expires_at', errors);
  if (input.pr !== null && typeof input.pr !== 'string') {
    errors.push('pr must be string or null');
  }
  if (typeof input.status !== 'string' || !VALID_STATUSES.has(input.status as MergeLockStatus)) {
    errors.push('status is required and must be valid');
  }
  if (!isRecord(input.owner)) {
    errors.push('owner is required');
  } else {
    requireString(input.owner, 'user', errors, 'owner.user');
    requireString(input.owner, 'host', errors, 'owner.host');
    requireString(input.owner, 'session_id', errors, 'owner.session_id');
    if (typeof input.owner.pid !== 'number' || !Number.isInteger(input.owner.pid)) {
      errors.push('owner.pid is required and must be an integer');
    }
  }

  for (const dateField of ['acquired_at', 'expires_at']) {
    const value = input[dateField];
    if (typeof value === 'string' && Number.isNaN(Date.parse(value))) {
      errors.push(`${dateField} must be ISO-8601`);
    }
  }

  return errors;
}

function buildLock(input: MergeLockInput, now: Date): MergeLock {
  const issueId = requireIssueId(input.issue_id);
  const acquiredAt = input.acquired_at ?? now.toISOString();
  const expiresAt =
    input.expires_at ?? new Date(now.getTime() + (input.ttl_ms ?? DEFAULT_TTL_MS)).toISOString();
  return {
    schema_version: 1,
    issue_id: issueId,
    branch: input.branch,
    pr: input.pr?.trim() || null,
    cwd: path.resolve(ROOT, input.cwd).replaceAll('\\', '/'),
    reason: input.reason,
    acquired_at: acquiredAt,
    expires_at: expiresAt,
    owner: input.owner,
    status: 'held',
  };
}

function writeNewLockExclusive(lockPath: string, lock: MergeLock): MergeLockResult {
  ensureDir(path.dirname(lockPath));
  const payload = `${JSON.stringify(lock, null, 2)}\n`;
  let fd: number | undefined;
  try {
    fd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(fd, payload, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      const existing = readMergeLock(lockPath);
      if (existing.ok) {
        return {
          ok: false,
          code: 'merge_lock_held',
          lock: existing.lock,
          lock_path: relativePathOrAbsolute(lockPath),
          message: `Merge lock is already held by ${existing.lock.issue_id}`,
        };
      }
    }
    return {
      ok: false,
      code: 'merge_lock_invalid',
      lock_path: relativePathOrAbsolute(lockPath),
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
  }

  return {
    ok: true,
    code: 'merge_lock_acquired',
    lock,
    lock_path: relativePathOrAbsolute(lockPath),
    message: `Merge lock acquired for ${lock.issue_id}`,
  };
}

function markExpiredLock(lock: MergeLock, now: Date, lockPath: string): MergeLock {
  if (lock.status !== 'held') {
    return lock;
  }
  if (new Date(lock.expires_at).getTime() > now.getTime()) {
    return lock;
  }

  lock.status = 'stale_reclaim_required';
  writeLockAtomic(lockPath, lock);
  return lock;
}

function missingInputFields(input: Partial<MergeLockInput>): string[] {
  const missing: string[] = [];
  if (!input.issue_id) missing.push('issue_id');
  if (!input.branch) missing.push('branch');
  if (!input.cwd) missing.push('cwd');
  if (!input.reason) missing.push('reason');
  if (!input.owner) missing.push('owner');
  return missing;
}

function requireString(
  input: Record<string, unknown>,
  key: string,
  errors: string[],
  label = key,
): void {
  if (typeof input[key] !== 'string' || input[key].trim() === '') {
    errors.push(`${label} is required`);
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function relativePathOrAbsolute(targetPath: string): string {
  return targetPath.startsWith(ROOT) ? relativeToRoot(targetPath) : targetPath;
}

function parseTtlMinutes(input: string | undefined): number | undefined {
  if (!input) {
    return undefined;
  }
  const minutes = Number.parseInt(input, 10);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error(`Invalid --ttl-minutes: ${input}`);
  }
  return minutes * 60 * 1000;
}

function cliInput(flags: Map<string, string[]>): MergeLockInput {
  return {
    issue_id: getFlag(flags, 'issue') ?? '',
    branch: getFlag(flags, 'branch') ?? '',
    pr: getFlag(flags, 'pr') ?? null,
    cwd: getFlag(flags, 'cwd') ?? ROOT,
    reason: getFlag(flags, 'reason') ?? '',
    owner: defaultMergeLockOwner(getFlag(flags, 'session-id')),
    ttl_ms: parseTtlMinutes(getFlag(flags, 'ttl-minutes')),
  };
}

function runCli(): void {
  const { positionals, flags, bools } = parseArgs(process.argv.slice(2));
  const command = positionals[0] ?? '';
  let result: MergeLockResult;

  try {
    switch (command) {
      case 'acquire':
        result = acquireMergeLock(cliInput(flags));
        break;
      case 'release':
        result = releaseMergeLock({
          issue_id: getFlag(flags, 'issue') ?? '',
          branch: getFlag(flags, 'branch'),
          force: bools.has('force'),
        });
        break;
      case 'reclaim':
        result = reclaimMergeLock(cliInput(flags));
        break;
      case 'guard':
        result = requireMergeLockHeld({
          issue_id: getFlag(flags, 'issue') ?? '',
          branch: getFlag(flags, 'branch'),
          reason: getFlag(flags, 'reason'),
        });
        break;
      case 'status':
        result = readMergeLock();
        break;
      default:
        throw new Error(
          'Usage: pnpm ops:merge-lock <acquire|release|reclaim|guard|status> --issue UTV2-### --branch <branch> --reason <reason>',
        );
    }

    emitJson(result);
    process.exitCode = result.ok || command === 'status' ? 0 : 1;
  } catch (error) {
    emitJson({
      ok: false,
      code: 'merge_lock_cli_failed',
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  }
}

const argv1 = process.argv[1] ?? '';
if (argv1 && import.meta.url === pathToFileURL(path.resolve(argv1)).href) {
  runCli();
}
