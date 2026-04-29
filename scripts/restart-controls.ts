import fs from 'node:fs';
import path from 'node:path';

export type RestartableService = 'api' | 'worker' | 'ingestor';
export type RestartAuditOutcome = 'allowed' | 'denied';
export type RestartDenialReason =
  | 'service_not_allowed'
  | 'cooldown'
  | 'global_rate_limit';

export interface RestartAuditEntry {
  service: string;
  command: 'restart';
  outcome: RestartAuditOutcome;
  reason: RestartDenialReason | 'executed';
  message: string;
  actor: string;
  timestamp: string;
}

export interface RestartPolicy {
  allowlist: readonly RestartableService[];
  serviceCooldownMs: number;
  globalWindowMs: number;
  globalLimit: number;
}

export interface RestartDecision {
  allowed: boolean;
  message: string;
  reason: RestartAuditEntry['reason'];
}

export const RESTART_POLICY: RestartPolicy = {
  allowlist: ['api', 'worker', 'ingestor'],
  serviceCooldownMs: 5 * 60_000,
  globalWindowMs: 60 * 60_000,
  globalLimit: 6,
};

export const MANUAL_APPROVAL_BOUNDARY =
  'Manual approval boundary: DB/Postgres, firewall, migration, and infrastructure actions are never restartable through this control surface.';

export function readRestartAuditLog(filePath: string): RestartAuditEntry[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as RestartAuditEntry;
        return parsed && typeof parsed === 'object' ? [parsed] : [];
      } catch {
        return [];
      }
    });
}

export function appendRestartAuditLog(filePath: string, entry: RestartAuditEntry) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
}

export function evaluateRestartRequest(input: {
  service: string;
  history: RestartAuditEntry[];
  now?: Date;
  policy?: RestartPolicy;
}): RestartDecision {
  const now = input.now ?? new Date();
  const policy = input.policy ?? RESTART_POLICY;

  if (!policy.allowlist.includes(input.service as RestartableService)) {
    return {
      allowed: false,
      reason: 'service_not_allowed',
      message: `Restart denied for "${input.service}". Service is not on the restart allowlist. ${MANUAL_APPROVAL_BOUNDARY}`,
    };
  }

  const executedHistory = input.history.filter((entry) => entry.outcome === 'allowed');
  const serviceHistory = executedHistory
    .filter((entry) => entry.service === input.service)
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  const latestServiceRestart = serviceHistory[0];

  if (latestServiceRestart) {
    const ageMs = now.getTime() - Date.parse(latestServiceRestart.timestamp);
    if (Number.isFinite(ageMs) && ageMs < policy.serviceCooldownMs) {
      const remainingSeconds = Math.max(
        1,
        Math.ceil((policy.serviceCooldownMs - ageMs) / 1000),
      );
      return {
        allowed: false,
        reason: 'cooldown',
        message: `Restart denied for "${input.service}" due to cooldown. Try again in ${remainingSeconds}s.`,
      };
    }
  }

  const windowStartMs = now.getTime() - policy.globalWindowMs;
  const recentRestarts = executedHistory.filter((entry) => {
    const timestampMs = Date.parse(entry.timestamp);
    return Number.isFinite(timestampMs) && timestampMs >= windowStartMs;
  });

  if (recentRestarts.length >= policy.globalLimit) {
    return {
      allowed: false,
      reason: 'global_rate_limit',
      message:
        `Restart denied because the global restart rate limit is active. ` +
        `${recentRestarts.length} restart(s) were already issued in the last ` +
        `${Math.round(policy.globalWindowMs / 60_000)}m.`,
    };
  }

  return {
    allowed: true,
    reason: 'executed',
    message:
      `Restart allowed for "${input.service}". Cooldown=${Math.round(
        policy.serviceCooldownMs / 60_000,
      )}m, global limit=${policy.globalLimit}/${Math.round(
        policy.globalWindowMs / 60_000,
      )}m.`,
  };
}

export function createRestartAuditEntry(input: {
  service: string;
  outcome: RestartAuditOutcome;
  reason: RestartAuditEntry['reason'];
  message: string;
  actor?: string;
  now?: Date;
}): RestartAuditEntry {
  return {
    service: input.service,
    command: 'restart',
    outcome: input.outcome,
    reason: input.reason,
    message: input.message,
    actor: input.actor ?? 'ops-bot',
    timestamp: (input.now ?? new Date()).toISOString(),
  };
}
