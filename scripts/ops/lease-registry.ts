import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type LaneExecutionLocation,
  normalizeExecutionCwd,
  validateLaneCwd,
  validateLeaseCwdCoherence,
} from './lane-execution.js';
import {
  ROOT,
  emitJson,
  ensureDir,
  getFlag,
  getFlags,
  normalizeFileScope,
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
  worktree_path?: string;
  execution_location?: Pick<LaneExecutionLocation, 'cwd'>;
  file_scope_lock: string[];
  heartbeat_at: string;
  expires_at: string;
  owner: LeaseOwner;
  status: LeaseStatus;
  reclaim_history?: LeaseReclaimRecord[];
}

export interface LeaseReclaimRecord {
  reclaimed_at: string;
  reclaimed_by: string;
  reason: string;
  previous_owner: LeaseOwner;
  previous_status: LeaseStatus;
  last_heartbeat_at: string;
  locked_files: string[];
  branch: string;
  branch_status: string;
  pr_status: string;
}

export interface LeaseReservationInput {
  issue_id: string;
  branch: string;
  executor: LeaseExecutor;
  cwd: string;
  worktree_path?: string;
  execution_location?: Pick<LaneExecutionLocation, 'cwd'>;
  file_scope_lock: string[];
  owner: LeaseOwner;
  heartbeat_at?: string;
  expires_at?: string;
  ttl_ms?: number;
}

export interface LeaseHeartbeatInput {
  issue_id: string;
  branch?: string;
  executor?: LeaseExecutor;
  cwd?: string;
  owner?: LeaseOwner;
  heartbeat_at?: string;
  ttl_ms?: number;
}

export interface LeaseReleaseInput {
  issue_id: string;
  actor: string;
  reason: string;
  released_at?: string;
}

export interface LeaseReclaimInput {
  issue_id: string;
  actor: string;
  reason: string;
  branch_status?: string;
  pr_status?: string;
  reclaimed_at?: string;
}

export type LeaseReserveResult =
  | {
      ok: true;
      code: 'lease_reserved' | 'lease_renewed' | 'lease_reclaimed' | 'lease_released';
      lease: DispatchLease;
      lease_path: string;
      stale_leases: DispatchLease[];
    }
  | {
      ok: false;
      code:
        | 'lease_missing_required_fields'
        | 'lease_invalid_existing'
        | 'lease_invalid_cwd'
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
const EXECUTOR_TTL_MS: Record<LeaseExecutor, number> = {
  claude: 48 * 60 * 60 * 1000,
  'codex-cli': DEFAULT_TTL_MS,
  'codex-cloud': DEFAULT_TTL_MS,
};
const ACTIVE_NON_RECLAIMED = new Set<LeaseStatus>(['active', 'stale_reclaim_required']);
const VALID_EXECUTORS = new Set<LeaseExecutor>(['claude', 'codex-cli', 'codex-cloud']);
const VALID_STATUSES = new Set<LeaseStatus>([
  'active',
  'stale_reclaim_required',
  'reclaimed',
  'released',
]);

export const LEASE_REGISTRY_DIR = path.join(ROOT, '.ops', 'leases');

export interface ActiveLeaseCheckInput {
  issue_id: string;
  branch: string;
  executor: LeaseExecutor;
  cwd: string;
  file_scope_lock: string[];
}

export function leaseTtlMsForExecutor(executor: LeaseExecutor): number {
  return EXECUTOR_TTL_MS[executor];
}

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
    new Date(now.getTime() + (input.ttl_ms ?? leaseTtlMsForExecutor(executor))).toISOString();
  let fileScopeLock: string[];
  try {
    fileScopeLock = normalizeFileScopeForLease(requestedScope);
  } catch (error) {
    return {
      ok: false,
      code: 'lease_missing_required_fields',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const cwdErrors = validateLaneCwd({ cwd, fileScope: fileScopeLock });
  const coherenceErrors = validateLeaseCwdCoherence({
    lease_cwd: cwd,
    worktree_path: input.worktree_path,
    execution_location: input.execution_location,
  });
  const executionErrors = [...cwdErrors, ...coherenceErrors];
  if (executionErrors.length > 0) {
    return {
      ok: false,
      code: 'lease_invalid_cwd',
      message: executionErrors.join('; '),
    };
  }
  const lease: DispatchLease = {
    schema_version: 1,
    issue_id: issueId,
    branch,
    executor,
    cwd: normalizeCwd(cwd),
    worktree_path: input.worktree_path ? normalizeCwd(input.worktree_path) : undefined,
    execution_location: input.execution_location
      ? { cwd: normalizeCwd(input.execution_location.cwd) }
      : undefined,
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

export function heartbeatLease(
  input: Partial<LeaseHeartbeatInput>,
  options: { registryDir?: string; now?: Date } = {},
): LeaseReserveResult {
  const registryDir = options.registryDir ?? LEASE_REGISTRY_DIR;
  const now = options.now ?? new Date();
  const issueId = requireIssueId(input.issue_id ?? '');
  const leasePath = leasePathForIssue(issueId, registryDir);
  if (!fs.existsSync(leasePath)) {
    return {
      ok: false,
      code: 'lease_invalid_existing',
      message: `Lease not found: ${issueId}`,
    };
  }

  let lease: DispatchLease;
  try {
    lease = JSON.parse(fs.readFileSync(leasePath, 'utf8')) as DispatchLease;
    const errors = validateLease(lease);
    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }
  } catch (error) {
    return {
      ok: false,
      code: 'lease_invalid_existing',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const requestedCwd = input.cwd ? normalizeCwd(input.cwd) : undefined;
  if (
    (input.branch && lease.branch !== input.branch) ||
    (input.executor && lease.executor !== input.executor) ||
    (requestedCwd && lease.cwd !== requestedCwd)
  ) {
    return {
      ok: false,
      code: 'lease_conflict',
      message: `Heartbeat target does not match lease ${issueId}`,
      conflicting_lease: lease,
    };
  }

  const heartbeatAt = input.heartbeat_at ?? now.toISOString();
  const ttlMs = input.ttl_ms ?? leaseTtlMsForExecutor(lease.executor);
  const updated: DispatchLease = {
    ...lease,
    owner: input.owner ?? lease.owner,
    heartbeat_at: heartbeatAt,
    expires_at: new Date(new Date(heartbeatAt).getTime() + ttlMs).toISOString(),
    status: 'active',
  };
  writeLeaseAtomic(leasePath, updated);
  return {
    ok: true,
    code: 'lease_renewed',
    lease: updated,
    lease_path: relativePathOrAbsolute(leasePath),
    stale_leases: [],
  };
}

export function reclaimLease(
  input: Partial<LeaseReclaimInput>,
  options: { registryDir?: string; now?: Date } = {},
): LeaseReserveResult {
  const registryDir = options.registryDir ?? LEASE_REGISTRY_DIR;
  const now = options.now ?? new Date();
  const issueId = requireIssueId(input.issue_id ?? '');
  if (!input.actor || !input.reason) {
    const missing = [
      ...(!input.actor ? ['actor'] : []),
      ...(!input.reason ? ['reason'] : []),
    ];
    return {
      ok: false,
      code: 'lease_missing_required_fields',
      message: `Missing required lease reclaim fields: ${missing.join(', ')}`,
      missing_fields: missing,
    };
  }

  const leasePath = leasePathForIssue(issueId, registryDir);
  if (!fs.existsSync(leasePath)) {
    return {
      ok: false,
      code: 'lease_invalid_existing',
      message: `Lease not found: ${issueId}`,
    };
  }

  const lease = JSON.parse(fs.readFileSync(leasePath, 'utf8')) as DispatchLease;
  const errors = validateLease(lease);
  if (errors.length > 0) {
    return {
      ok: false,
      code: 'lease_invalid_existing',
      message: errors.join('; '),
    };
  }
  const expired = new Date(lease.expires_at).getTime() <= now.getTime();
  if (lease.status === 'active' && !expired) {
    return {
      ok: false,
      code: 'lease_conflict',
      message: `Lease ${issueId} is not stale and cannot be reclaimed`,
      conflicting_lease: lease,
    };
  }

  const reclaimed: DispatchLease = {
    ...lease,
    status: 'reclaimed',
    reclaim_history: [
      ...(lease.reclaim_history ?? []),
      {
        reclaimed_at: input.reclaimed_at ?? now.toISOString(),
        reclaimed_by: input.actor,
        reason: input.reason,
        previous_owner: lease.owner,
        previous_status: lease.status,
        last_heartbeat_at: lease.heartbeat_at,
        locked_files: lease.file_scope_lock,
        branch: lease.branch,
        branch_status: input.branch_status ?? 'unknown',
        pr_status: input.pr_status ?? 'unknown',
      },
    ],
  };
  writeLeaseAtomic(leasePath, reclaimed);
  return {
    ok: true,
    code: 'lease_reclaimed',
    lease: reclaimed,
    lease_path: relativePathOrAbsolute(leasePath),
    stale_leases: [],
  };
}

export function releaseLease(
  input: Partial<LeaseReleaseInput>,
  options: { registryDir?: string; now?: Date } = {},
): LeaseReserveResult {
  const registryDir = options.registryDir ?? LEASE_REGISTRY_DIR;
  const now = options.now ?? new Date();
  const issueId = requireIssueId(input.issue_id ?? '');
  if (!input.actor || !input.reason) {
    const missing = [
      ...(!input.actor ? ['actor'] : []),
      ...(!input.reason ? ['reason'] : []),
    ];
    return {
      ok: false,
      code: 'lease_missing_required_fields',
      message: `Missing required lease release fields: ${missing.join(', ')}`,
      missing_fields: missing,
    };
  }

  const leasePath = leasePathForIssue(issueId, registryDir);
  if (!fs.existsSync(leasePath)) {
    return {
      ok: false,
      code: 'lease_invalid_existing',
      message: `Lease not found: ${issueId}`,
    };
  }

  const lease = JSON.parse(fs.readFileSync(leasePath, 'utf8')) as DispatchLease;
  const errors = validateLease(lease);
  if (errors.length > 0) {
    return {
      ok: false,
      code: 'lease_invalid_existing',
      message: errors.join('; '),
    };
  }

  const released: DispatchLease = {
    ...lease,
    status: 'released',
    reclaim_history: [
      ...(lease.reclaim_history ?? []),
      {
        reclaimed_at: input.released_at ?? now.toISOString(),
        reclaimed_by: input.actor,
        reason: `released: ${input.reason}`,
        previous_owner: lease.owner,
        previous_status: lease.status,
        last_heartbeat_at: lease.heartbeat_at,
        locked_files: lease.file_scope_lock,
        branch: lease.branch,
        branch_status: 'released_by_owner',
        pr_status: 'released_by_owner',
      },
    ],
  };
  writeLeaseAtomic(leasePath, released);
  return {
    ok: true,
    code: 'lease_released',
    lease: released,
    lease_path: relativePathOrAbsolute(leasePath),
    stale_leases: [],
  };
}

export function validateActiveLeaseForLane(
  input: ActiveLeaseCheckInput,
  registryDir = LEASE_REGISTRY_DIR,
  now = new Date(),
): string[] {
  const issueId = requireIssueId(input.issue_id);
  const expectedCwd = normalizeCwd(input.cwd);
  let expectedScope: string[];
  try {
    expectedScope = normalizeFileScopeForLease(input.file_scope_lock);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  let leases: DispatchLease[];
  try {
    leases = readAllLeases(registryDir);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  markExpiredActiveLeases(leases, now, registryDir);
  const lease = leases.find((candidate) => candidate.issue_id === issueId);
  if (!lease) {
    return [`matching active lease required for ${issueId}`];
  }
  const errors: string[] = [];
  if (lease.status !== 'active') {
    errors.push(`lease status must be active, got ${lease.status}`);
  }
  if (new Date(lease.expires_at).getTime() <= now.getTime()) {
    errors.push('lease is expired');
  }
  if (lease.branch !== input.branch) {
    errors.push(`lease branch mismatch: expected ${input.branch}, got ${lease.branch}`);
  }
  if (lease.executor !== input.executor) {
    errors.push(`lease executor mismatch: expected ${input.executor}, got ${lease.executor}`);
  }
  if (lease.cwd !== expectedCwd) {
    errors.push(`lease cwd mismatch: expected ${expectedCwd}, got ${lease.cwd}`);
  }
  if (!sameStringSet(lease.file_scope_lock, expectedScope)) {
    errors.push(
      `lease file_scope_lock mismatch: expected ${expectedScope.join(', ')}, got ${lease.file_scope_lock.join(', ')}`,
    );
  }
  return errors;
}

export function buildLeaseStaleReport(
  registryDir = LEASE_REGISTRY_DIR,
  now = new Date(),
): {
  schema_version: 1;
  run_at: string;
  stale_count: number;
  leases: Array<{
    issue_id: string;
    executor: LeaseExecutor;
    branch: string;
    cwd: string;
    heartbeat_at: string;
    expires_at: string;
    threshold_ms: number;
    status: LeaseStatus;
    owner: LeaseOwner;
    file_scope_lock: string[];
  }>;
} {
  const leases = readAllLeases(registryDir);
  const stale = markExpiredActiveLeases(leases, now, registryDir)
    .concat(leases.filter((lease) => lease.status === 'stale_reclaim_required'));
  const unique = new Map(stale.map((lease) => [lease.issue_id, lease]));
  return {
    schema_version: 1,
    run_at: now.toISOString(),
    stale_count: unique.size,
    leases: [...unique.values()].map((lease) => ({
      issue_id: lease.issue_id,
      executor: lease.executor,
      branch: lease.branch,
      cwd: lease.cwd,
      heartbeat_at: lease.heartbeat_at,
      expires_at: lease.expires_at,
      threshold_ms: leaseTtlMsForExecutor(lease.executor),
      status: lease.status,
      owner: lease.owner,
      file_scope_lock: lease.file_scope_lock,
    })),
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
  if (typeof input.worktree_path === 'string' && input.worktree_path.trim() === '') {
    errors.push('worktree_path must be non-empty when present');
  }
  if (isRecord(input.execution_location)) {
    requireString(input.execution_location, 'cwd', errors, 'execution_location.cwd');
  }
  requireString(input, 'heartbeat_at', errors);
  requireString(input, 'expires_at', errors);
  if (typeof input.executor !== 'string' || !VALID_EXECUTORS.has(input.executor as LeaseExecutor)) {
    errors.push('executor is required and must be valid');
  }
  if (typeof input.status !== 'string' || !VALID_STATUSES.has(input.status as LeaseStatus)) {
    errors.push('status is required and must be valid');
  }
  if (input.reclaim_history !== undefined && !Array.isArray(input.reclaim_history)) {
    errors.push('reclaim_history must be an array when present');
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

  if (typeof input.cwd === 'string') {
    const coherenceErrors = validateLeaseCwdCoherence({
      lease_cwd: input.cwd,
      worktree_path: typeof input.worktree_path === 'string' ? input.worktree_path : undefined,
      execution_location: isRecord(input.execution_location) &&
        typeof input.execution_location.cwd === 'string'
        ? { cwd: input.execution_location.cwd }
        : undefined,
    });
    errors.push(...coherenceErrors);
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
  return normalizeExecutionCwd(path.isAbsolute(input) ? input : path.resolve(ROOT, input));
}

function normalizeFileScopeForLease(pathsToNormalize: string[]): string[] {
  return normalizeFileScope(pathsToNormalize);
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((entry) => rightSet.has(entry));
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
  const { positionals, flags, bools } = parseArgs(process.argv.slice(2));
  const command = positionals[0] ?? '';

  try {
    if (command === 'heartbeat') {
      const result = heartbeatLease({
        issue_id: getFlag(flags, 'issue'),
        branch: getFlag(flags, 'branch'),
        executor: getFlag(flags, 'executor') as LeaseExecutor | undefined,
        cwd: getFlag(flags, 'cwd'),
        owner: defaultLeaseOwner(getFlag(flags, 'session-id')),
        ttl_ms: parseTtlMinutes(getFlag(flags, 'ttl-minutes')),
      });
      emitJson(result);
      process.exitCode = result.ok ? 0 : 1;
      return;
    }

    if (command === 'reclaim') {
      const result = reclaimLease({
        issue_id: getFlag(flags, 'issue'),
        actor: getFlag(flags, 'actor') ?? '',
        reason: getFlag(flags, 'reason') ?? '',
        branch_status: getFlag(flags, 'branch-status'),
        pr_status: getFlag(flags, 'pr-status'),
      });
      emitJson(result);
      process.exitCode = result.ok ? 0 : 1;
      return;
    }

    if (command === 'release') {
      const result = releaseLease({
        issue_id: getFlag(flags, 'issue'),
        actor: getFlag(flags, 'actor') ?? '',
        reason: getFlag(flags, 'reason') ?? '',
      });
      emitJson(result);
      process.exitCode = result.ok ? 0 : 1;
      return;
    }

    if (command === 'report') {
      const report = buildLeaseStaleReport();
      if (bools.has('json')) {
        emitJson(report);
      } else {
        console.log(`[ops:lease report] stale_count=${report.stale_count}`);
        for (const lease of report.leases) {
          console.log(
            `  [STALE] ${lease.issue_id} ${lease.executor} ${lease.branch} heartbeat=${lease.heartbeat_at} cwd=${lease.cwd}`,
          );
        }
      }
      process.exitCode = 0;
      return;
    }

    if (command !== 'reserve') {
      throw new Error('Usage: pnpm ops:lease <reserve|heartbeat|reclaim|release|report> --issue UTV2-### --branch <branch> --executor <executor> --cwd <path> --files <path>');
    }

    const result = reserveLease({
      issue_id: getFlag(flags, 'issue'),
      branch: getFlag(flags, 'branch'),
      executor: getFlag(flags, 'executor') as LeaseExecutor | undefined,
      cwd: getFlag(flags, 'cwd') ?? ROOT,
      worktree_path: getFlag(flags, 'worktree-path'),
      execution_location: getFlag(flags, 'execution-cwd')
        ? { cwd: getFlag(flags, 'execution-cwd')! }
        : undefined,
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
