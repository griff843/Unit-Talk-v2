import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ROOT,
  emitJson,
  ensureDir,
  getFlag,
  getFlags,
  normalizeRepoRelativePaths,
  parseArgs,
  relativeToRoot,
  requireIssueId,
} from './shared.js';

export type LeaseExecutor = 'claude' | 'codex-cli' | 'codex-cloud';
export type LeaseStatus = 'active' | 'stale_reclaim_required' | 'reclaimed' | 'released';

export interface LeaseOwner {
  user: string;
  host: string;
  pid: number;
  session_id: string;
}

export interface DispatchLease {
  schema_version: 1;
  issue_id: string;
  branch: string;
  executor: LeaseExecutor;
  cwd: string;
  file_scope_lock: string[];
  heartbeat_at: string;
  expires_at: string;
  owner: LeaseOwner;
  status: LeaseStatus;
}

export interface LeaseReservationInput {
  issue_id: string;
  branch: string;
  executor: LeaseExecutor;
  cwd: string;
  file_scope_lock: string[];
  owner: LeaseOwner;
  heartbeat_at?: string;
  expires_at?: string;
  ttl_ms?: number;
}

export type LeaseReserveResult =
  | {
      ok: true;
      code: 'lease_reserved' | 'lease_renewed';
      lease: DispatchLease;
      lease_path: string;
      stale_leases: DispatchLease[];
    }
  | {
      ok: false;
      code:
        | 'lease_missing_required_fields'
        | 'lease_invalid_existing'
        | 'lease_conflict'
        | 'lease_stale_reclaim_required';
      message: string;
      missing_fields?: string[];
      lease?: DispatchLease;
      conflicting_lease?: DispatchLease;
      overlapping_files?: string[];
      stale_leases?: DispatchLease[];
    };

const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000;
const ACTIVE_NON_RECLAIMED = new Set<LeaseStatus>(['active', 'stale_reclaim_required']);
const VALID_EXECUTORS = new Set<LeaseExecutor>(['claude', 'codex-cli', 'codex-cloud']);
const VALID_STATUSES = new Set<LeaseStatus>([
  'active',
  'stale_reclaim_required',
  'reclaimed',
  'released',
]);

export const LEASE_REGISTRY_DIR = path.join(ROOT, '.ops', 'leases');

export function defaultLeaseOwner(sessionId = process.env.CODEX_SESSION_ID): LeaseOwner {
  return {
    user: os.userInfo().username || 'unknown',
    host: os.hostname() || 'unknown',
    pid: process.pid,
    session_id: sessionId?.trim() || `${os.hostname()}:${process.pid}`,
  };
}

export function leasePathForIssue(
  issueId: string,
  registryDir = LEASE_REGISTRY_DIR,
): string {
  return path.join(registryDir, `${issueId.toUpperCase()}.json`);
}

export function readAllLeases(registryDir = LEASE_REGISTRY_DIR): DispatchLease[] {
  if (!fs.existsSync(registryDir)) {
    return [];
  }

  return fs
    .readdirSync(registryDir)
    .filter((entry) => entry.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => {
      const leasePath = path.join(registryDir, entry);
      const lease = JSON.parse(fs.readFileSync(leasePath, 'utf8')) as unknown;
      const errors = validateLease(lease);
      if (errors.length > 0) {
        throw new Error(`${relativePathOrAbsolute(leasePath)}: ${errors.join('; ')}`);
      }
      return lease as DispatchLease;
    });
}

export function writeLeaseAtomic(
  leasePath: string,
  lease: DispatchLease,
  tempSuffix = `${process.pid}.${Date.now()}.tmp`,
): void {
  const errors = validateLease(lease);
  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }

  ensureDir(path.dirname(leasePath));
  const tempPath = `${leasePath}.${tempSuffix}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(lease, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, leasePath);
}

export function reserveLease(
  input: Partial<LeaseReservationInput>,
  options: { registryDir?: string; now?: Date } = {},
): LeaseReserveResult {
  const registryDir = options.registryDir ?? LEASE_REGISTRY_DIR;
  const now = options.now ?? new Date();
  const missingFields = missingReservationFields(input);
  if (missingFields.length > 0) {
    return {
      ok: false,
      code: 'lease_missing_required_fields',
      message: `Missing required lease fields: ${missingFields.join(', ')}`,
      missing_fields: missingFields,
    };
  }

  const issueId = requireIssueId(input.issue_id ?? '');
  const branch = input.branch ?? '';
  const executor = input.executor;
  const cwd = input.cwd ?? '';
  const owner = input.owner ?? defaultLeaseOwner();
  const requestedScope = input.file_scope_lock ?? [];
  if (!executor || !VALID_EXECUTORS.has(executor)) {
    return {
      ok: false,
      code: 'lease_missing_required_fields',
      message: `Invalid executor: ${input.executor}`,
      missing_fields: ['executor'],
    };
  }

  const heartbeatAt = input.heartbeat_at ?? now.toISOString();
  const expiresAt =
    input.expires_at ??
    new Date(now.getTime() + (input.ttl_ms ?? DEFAULT_TTL_MS)).toISOString();
  const fileScopeLock = normalizeRepoRelativePaths(requestedScope);
  const lease: DispatchLease = {
    schema_version: 1,
    issue_id: issueId,
    branch,
    executor,
    cwd: normalizeCwd(cwd),
    file_scope_lock: fileScopeLock,
    heartbeat_at: heartbeatAt,
    expires_at: expiresAt,
    owner,
    status: 'active',
  };

  const leaseErrors = validateLease(lease);
  if (leaseErrors.length > 0) {
    return {
      ok: false,
      code: 'lease_missing_required_fields',
      message: `Invalid lease reservation: ${leaseErrors.join('; ')}`,
    };
  }

  let existingLeases: DispatchLease[];
  try {
    existingLeases = readAllLeases(registryDir);
  } catch (error) {
    return {
      ok: false,
      code: 'lease_invalid_existing',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const staleLeases = markExpiredActiveLeases(existingLeases, now, registryDir);
  for (const existing of existingLeases) {
    if (!ACTIVE_NON_RECLAIMED.has(existing.status)) {
      continue;
    }

    const overlappingFiles = overlappingScope(fileScopeLock, existing.file_scope_lock);
    if (overlappingFiles.length === 0) {
      continue;
    }

    const sameLease =
      existing.issue_id === lease.issue_id &&
      existing.branch === lease.branch &&
      existing.executor === lease.executor &&
      existing.cwd === lease.cwd;
    if (sameLease && existing.status === 'active') {
      const leasePath = leasePathForIssue(issueId, registryDir);
      writeLeaseAtomic(leasePath, lease);
      return {
        ok: true,
        code: 'lease_renewed',
        lease,
        lease_path: relativePathOrAbsolute(leasePath),
        stale_leases: staleLeases,
      };
    }

    return {
      ok: false,
      code:
        existing.status === 'stale_reclaim_required'
          ? 'lease_stale_reclaim_required'
          : 'lease_conflict',
      message:
        existing.status === 'stale_reclaim_required'
          ? `Expired lease for ${existing.issue_id} requires explicit reclaim`
          : `Requested scope overlaps active lease for ${existing.issue_id}`,
      conflicting_lease: existing,
      overlapping_files: overlappingFiles,
      stale_leases: staleLeases,
    };
  }

  const leasePath = leasePathForIssue(issueId, registryDir);
  writeLeaseAtomic(leasePath, lease);
  return {
    ok: true,
    code: 'lease_reserved',
    lease,
    lease_path: relativePathOrAbsolute(leasePath),
    stale_leases: staleLeases,
  };
}

export function validateLease(input: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return ['lease must be an object'];
  }

  if (input.schema_version !== 1) {
    errors.push('schema_version must be 1');
  }
  requireString(input, 'issue_id', errors);
  requireString(input, 'branch', errors);
  requireString(input, 'cwd', errors);
  requireString(input, 'heartbeat_at', errors);
  requireString(input, 'expires_at', errors);
  if (typeof input.executor !== 'string' || !VALID_EXECUTORS.has(input.executor as LeaseExecutor)) {
    errors.push('executor is required and must be valid');
  }
  if (typeof input.status !== 'string' || !VALID_STATUSES.has(input.status as LeaseStatus)) {
    errors.push('status is required and must be valid');
  }
  if (!Array.isArray(input.file_scope_lock) || input.file_scope_lock.length === 0) {
    errors.push('file_scope_lock must contain at least one path');
  } else if (input.file_scope_lock.some((entry) => typeof entry !== 'string' || entry.trim() === '')) {
    errors.push('file_scope_lock entries must be non-empty strings');
  }
  if (!isRecord(input.owner)) {
    errors.push('owner is required');
  } else {
    requireString(input.owner, 'user', errors, 'owner.user');
    requireString(input.owner, 'host', errors, 'owner.host');
    if (typeof input.owner.pid !== 'number' || !Number.isInteger(input.owner.pid)) {
      errors.push('owner.pid is required and must be an integer');
    }
    requireString(input.owner, 'session_id', errors, 'owner.session_id');
  }

  for (const dateField of ['heartbeat_at', 'expires_at']) {
    const value = input[dateField];
    if (typeof value === 'string' && Number.isNaN(Date.parse(value))) {
      errors.push(`${dateField} must be ISO-8601`);
    }
  }

  return errors;
}

function markExpiredActiveLeases(
  leases: DispatchLease[],
  now: Date,
  registryDir: string,
): DispatchLease[] {
  const staleLeases: DispatchLease[] = [];
  for (const lease of leases) {
    if (lease.status !== 'active') {
      continue;
    }
    if (new Date(lease.expires_at).getTime() > now.getTime()) {
      continue;
    }

    lease.status = 'stale_reclaim_required';
    staleLeases.push(lease);
    writeLeaseAtomic(leasePathForIssue(lease.issue_id, registryDir), lease);
  }

  return staleLeases;
}

function missingReservationFields(input: Partial<LeaseReservationInput>): string[] {
  const missing: string[] = [];
  if (!input.issue_id) missing.push('issue_id');
  if (!input.branch) missing.push('branch');
  if (!input.executor) missing.push('executor');
  if (!input.cwd) missing.push('cwd');
  if (!input.owner) missing.push('owner');
  if (!Array.isArray(input.file_scope_lock) || input.file_scope_lock.length === 0) {
    missing.push('file_scope_lock');
  }
  return missing;
}

function normalizeCwd(input: string): string {
  return path.resolve(ROOT, input).replaceAll('\\', '/');
}

function overlapsPath(left: string, right: string): boolean {
  const lhs = normalizeLockPattern(left);
  const rhs = normalizeLockPattern(right);
  return lhs === rhs || lhs.startsWith(`${rhs}/`) || rhs.startsWith(`${lhs}/`);
}

function overlappingScope(left: string[], right: string[]): string[] {
  return left.filter((leftPath) => right.some((rightPath) => overlapsPath(leftPath, rightPath)));
}

function normalizeLockPattern(input: string): string {
  return input
    .replaceAll('\\', '/')
    .replace(/\/\*\*$/, '')
    .replace(/\/+$/, '');
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

function runCli(): void {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const command = positionals[0] ?? '';

  try {
    if (command !== 'reserve') {
      throw new Error('Usage: pnpm ops:lease reserve --issue UTV2-### --branch <branch> --executor <executor> --cwd <path> --files <path>');
    }

    const result = reserveLease({
      issue_id: getFlag(flags, 'issue'),
      branch: getFlag(flags, 'branch'),
      executor: getFlag(flags, 'executor') as LeaseExecutor | undefined,
      cwd: getFlag(flags, 'cwd') ?? ROOT,
      file_scope_lock: getFlags(flags, 'files'),
      owner: defaultLeaseOwner(getFlag(flags, 'session-id')),
      ttl_ms: parseTtlMinutes(getFlag(flags, 'ttl-minutes')),
    });
    emitJson(result);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    emitJson({
      ok: false,
      code: 'lease_cli_failed',
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  }
}

const argv1 = process.argv[1] ?? '';
if (argv1 && import.meta.url === pathToFileURL(path.resolve(argv1)).href) {
  runCli();
}
