import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRuntimeDependencies } from '../server.js';
import { readJsonBody } from '../server.js';
import { writeJson } from '../http-utils.js';
import type { AuthContext } from '../auth.js';
import { promotionTargets, type PromotionTarget } from '@unit-talk/contracts';

/**
 * UTV2-1427: staff-authorized, auditable, reversible live kill switch for
 * public delivery targets. Distinct from the enabled/rolloutPct registry —
 * this is a runtime toggle read fresh by the worker before every dequeue,
 * with no code deploy required to flip it.
 */

interface KillSwitchRequestBody {
  target?: unknown;
  killed?: unknown;
  reason?: unknown;
}

function isValidTarget(value: unknown): value is PromotionTarget {
  return typeof value === 'string' && (promotionTargets as readonly string[]).includes(value);
}

export async function handleKillSwitchSet(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  const body = (await readJsonBody(request, runtime.bodyLimitBytes)) as KillSwitchRequestBody;

  if (!isValidTarget(body.target)) {
    return writeJson(response, 400, {
      ok: false,
      error: { code: 'INVALID_TARGET', message: `target must be one of: ${promotionTargets.join(', ')}` },
    });
  }
  if (typeof body.killed !== 'boolean') {
    return writeJson(response, 400, {
      ok: false,
      error: { code: 'INVALID_KILLED', message: 'killed must be a boolean' },
    });
  }
  // UTV2-1427 fix: actor is derived from the authenticated request context
  // (attached by the auth gate in server.ts before this handler runs), never
  // from client-supplied body — a client could otherwise spoof any identity
  // in the audit_log trail for a security-sensitive toggle.
  const auth = (request as IncomingMessage & { auth?: AuthContext }).auth;
  if (!auth) {
    return writeJson(response, 401, {
      ok: false,
      error: { code: 'UNAUTHENTICATED', message: 'authenticated actor required' },
    });
  }
  const actor = auth.identity;
  const reason = typeof body.reason === 'string' ? body.reason : undefined;

  if (!runtime.repositories.killSwitch) {
    return writeJson(response, 503, {
      ok: false,
      error: { code: 'KILL_SWITCH_UNAVAILABLE', message: 'delivery kill switch repository is not configured' },
    });
  }

  const row = await runtime.repositories.killSwitch.setKilled({
    target: body.target,
    killed: body.killed,
    actor,
    ...(reason === undefined ? {} : { reason }),
  });

  await runtime.repositories.audit.record({
    entityType: 'delivery_target',
    entityRef: row.target,
    action: row.killed ? 'discord_kill_switch.engaged' : 'discord_kill_switch.released',
    actor: row.actor ?? undefined,
    payload: { target: row.target, killed: row.killed, reason: row.reason },
  });

  writeJson(response, 200, { ok: true, target: row.target, killed: row.killed, reason: row.reason, updatedAt: row.updatedAt });
}

export async function handleKillSwitchList(
  _request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
): Promise<void> {
  if (!runtime.repositories.killSwitch) {
    return writeJson(response, 200, { ok: true, targets: [] });
  }
  const rows = await runtime.repositories.killSwitch.listAll();
  writeJson(response, 200, { ok: true, targets: rows });
}
