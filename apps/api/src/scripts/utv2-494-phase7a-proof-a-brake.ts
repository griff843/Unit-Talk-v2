/**
 * UTV2-494 Lane A — Phase 7A Governance Brake Proof (autonomous sources blocked)
 *
 * Proves the Phase 7A submission-time brake against the LIVE API + LIVE DB:
 * autonomous pick sources (system-pick-scanner, alert-agent, model-driven) must
 * land in `awaiting_approval`, must NOT auto-enqueue to distribution_outbox, and
 * must leave a `pick.governance_brake.applied` audit row.
 *
 * Assertions:
 *   A1  Each autonomous source pick lands in picks.status = 'awaiting_approval'
 *   A2  Zero rows in distribution_outbox for any of the braked pick ids
 *   A3  audit_log has a 'pick.governance_brake.applied' row referencing each pick id
 *        (matched via payload->>'pickId', since the brake audit sets entity_id to
 *        the lifecycle event id, not the pick id — repo truth)
 *
 * Prerequisites:
 *   - API running at http://localhost:4000 (persistenceMode=database, fail_open)
 *   - local.env with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *   - UNIT_TALK_SHADOW_MODE NOT set to 'routing' (otherwise model-driven takes
 *     the shadow path and is NOT braked — verified via env at startup)
 *
 * Run:
 *   npx tsx apps/api/src/scripts/utv2-494-phase7a-proof-a-brake.ts
 *
 * Exit 0 = 3/3 PASS
 * Exit 1 = one or more assertions FAIL
 */

import { loadEnvironment } from '@unit-talk/config';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const env = loadEnvironment();
const SUPABASE_URL = env.SUPABASE_URL!;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY!;
const API_BASE = process.env['UTV2_494_API_BASE'] ?? 'http://localhost:4000';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

const BASE_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

// ---------------------------------------------------------------------------
// REST helpers
// ---------------------------------------------------------------------------

async function queryRows<T>(
  table: string,
  select: string,
  filters: Record<string, string> = {},
  limit = 100,
): Promise<{ rows: T[]; error?: string }> {
  const qs = new URLSearchParams({ select, limit: String(limit), ...filters }).toString();
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    headers: { ...BASE_HEADERS, Prefer: 'return=representation' },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    return { rows: [], error: `HTTP ${resp.status}: ${body}` };
  }
  const rows = (await resp.json()) as T[];
  return { rows };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AssertionResult {
  assertion: string;
  result: 'PASS' | 'FAIL';
  evidence: Record<string, unknown>;
}

function pass(assertion: string, evidence: Record<string, unknown>): AssertionResult {
  return { assertion, result: 'PASS', evidence };
}

function fail(assertion: string, evidence: Record<string, unknown>): AssertionResult {
  return { assertion, result: 'FAIL', evidence };
}

type BrakeSource = 'system-pick-scanner' | 'alert-agent' | 'model-driven';

interface SubmissionResult {
  source: BrakeSource;
  fixtureId: string;
  httpStatus: number;
  pickId: string | null;
  lifecycleState: string | null;
  governanceBrake: boolean | null;
  outboxEnqueued: boolean | null;
  rawBody: unknown;
}

// ---------------------------------------------------------------------------
// Submit one pick per autonomous source via the live API
// ---------------------------------------------------------------------------

async function submitPick(source: BrakeSource): Promise<SubmissionResult> {
  const fixtureId = `utv2-494-lane-a-${source}-${Date.now()}`;
  // UTV2-522: inject the per-fixture marker into `selection` so the
  // idempotency key (computeSubmissionIdempotencyKey in submission-service.ts
  // hashes source|market|selection|line|odds|eventName) differs on every run
  // and the script can re-run against live DB without colliding with prior
  // stranded fixtures. Assertion semantics unchanged.
  const payload = {
    source,
    market: 'NBA points',
    selection: `Player Over 18.5 [${fixtureId}]`,
    line: 18.5,
    odds: -110,
    stakeUnits: 1,
    confidence: 0.7,
    metadata: {
      proof_fixture_id: fixtureId,
      proof_issue: 'UTV2-494',
      proof_lane: 'A',
    },
  };

  const resp = await fetch(`${API_BASE}/api/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const bodyText = await resp.text();
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = { raw: bodyText };
  }

  const envelope = body as {
    ok?: boolean;
    data?: {
      pickId?: string;
      lifecycleState?: string;
      governanceBrake?: boolean;
      outboxEnqueued?: boolean;
    };
  };

  return {
    source,
    fixtureId,
    httpStatus: resp.status,
    pickId: envelope?.data?.pickId ?? null,
    lifecycleState: envelope?.data?.lifecycleState ?? null,
    governanceBrake: envelope?.data?.governanceBrake ?? null,
    outboxEnqueued: envelope?.data?.outboxEnqueued ?? null,
    rawBody: body,
  };
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

async function assertA1(submissions: SubmissionResult[]): Promise<AssertionResult> {
  const label = 'A1: autonomous sources land in picks.status = awaiting_approval';

  const missing = submissions.filter((s) => !s.pickId);
  if (missing.length > 0) {
    return fail(label, {
      note: 'one or more submissions did not return a pick id',
      missing: missing.map((m) => ({
        source: m.source,
        httpStatus: m.httpStatus,
        rawBody: m.rawBody,
      })),
    });
  }

  const pickIds = submissions.map((s) => s.pickId!);
  const { rows, error } = await queryRows<{ id: string; status: string; source: string }>(
    'picks',
    'id,status,source',
    { id: `in.(${pickIds.join(',')})` },
    pickIds.length,
  );

  if (error) return fail(label, { error, pickIds });
  if (rows.length !== pickIds.length) {
    return fail(label, {
      expectedCount: pickIds.length,
      actualCount: rows.length,
      pickIds,
      returnedRows: rows,
    });
  }

  const byId = new Map(rows.map((r) => [r.id, r] as const));
  const checks = submissions.map((s) => {
    const row = byId.get(s.pickId!);
    return {
      source: s.source,
      pickId: s.pickId,
      dbStatus: row?.status ?? null,
      dbSource: row?.source ?? null,
      awaitingApproval: row?.status === 'awaiting_approval',
      responseLifecycleState: s.lifecycleState,
      responseGovernanceBrake: s.governanceBrake,
    };
  });

  const broken = checks.filter((c) => !c.awaitingApproval);
  if (broken.length > 0) {
    return fail(label, { checks, broken });
  }

  return pass(label, {
    sourceCount: 3,
    checks,
  });
}

async function assertA2(submissions: SubmissionResult[]): Promise<AssertionResult> {
  const label = 'A2: no distribution_outbox rows exist for any braked pick id';

  const pickIds = submissions.map((s) => s.pickId).filter((id): id is string => !!id);
  if (pickIds.length !== 3) {
    return fail(label, {
      note: 'could not evaluate — not all 3 submissions returned a pick id',
      pickIds,
    });
  }

  const { rows, error } = await queryRows<{
    id: string;
    pick_id: string;
    status: string;
    target: string;
  }>(
    'distribution_outbox',
    'id,pick_id,status,target',
    { pick_id: `in.(${pickIds.join(',')})` },
    50,
  );

  if (error) return fail(label, { error, pickIds });

  if (rows.length > 0) {
    return fail(label, {
      pickIds,
      unexpectedOutboxRows: rows,
    });
  }

  return pass(label, {
    pickIds,
    outboxRowCount: 0,
    note: 'all statuses inspected (no status filter applied to query)',
  });
}

async function assertA3(submissions: SubmissionResult[]): Promise<AssertionResult> {
  const label = 'A3: audit_log has pick.governance_brake.applied row per braked pick id';

  const pickIds = submissions.map((s) => s.pickId).filter((id): id is string => !!id);
  if (pickIds.length !== 3) {
    return fail(label, {
      note: 'could not evaluate — not all 3 submissions returned a pick id',
      pickIds,
    });
  }

  // The submit-pick-controller records the brake audit with:
  //   entity_type = 'picks'
  //   entity_id   = lifecycle_event id (NOT the pick id)
  //   entity_ref  = null
  //   payload     = { pickId, source, ... }
  // So we match by action + payload->>pickId.
  const perPick: Array<{
    pickId: string;
    source: string;
    found: boolean;
    auditRowId: string | null;
    payloadSource: string | null;
    fromState: string | null;
    toState: string | null;
  }> = [];

  for (const sub of submissions) {
    const { rows, error } = await queryRows<{
      id: string;
      action: string;
      entity_type: string;
      payload: Record<string, unknown> | null;
    }>(
      'audit_log',
      'id,action,entity_type,payload',
      {
        action: 'eq.pick.governance_brake.applied',
        'payload->>pickId': `eq.${sub.pickId!}`,
      },
      5,
    );

    if (error) {
      return fail(label, { error, pickId: sub.pickId, source: sub.source });
    }

    const row = rows[0] ?? null;
    perPick.push({
      pickId: sub.pickId!,
      source: sub.source,
      found: !!row,
      auditRowId: row?.id ?? null,
      payloadSource: (row?.payload?.['source'] as string | undefined) ?? null,
      fromState: (row?.payload?.['fromState'] as string | undefined) ?? null,
      toState: (row?.payload?.['toState'] as string | undefined) ?? null,
    });
  }

  const missing = perPick.filter((p) => !p.found);
  if (missing.length > 0) {
    return fail(label, { perPick, missing });
  }

  const wrongTransition = perPick.filter(
    (p) => p.fromState !== 'validated' || p.toState !== 'awaiting_approval',
  );
  if (wrongTransition.length > 0) {
    return fail(label, { perPick, wrongTransition });
  }

  return pass(label, { perPick });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== UTV2-494 Lane A: Phase 7A Governance Brake Proof ===');
  console.log(`API_BASE=${API_BASE}`);
  console.log(`SUPABASE_URL=${SUPABASE_URL}`);
  console.log(`UNIT_TALK_SHADOW_MODE=${process.env['UNIT_TALK_SHADOW_MODE'] ?? '<unset>'}`);
  console.log('');

  // Sanity-check shadow mode — if routing shadow is on, model-driven path
  // skips the brake and this proof is invalid. Report and fail early.
  const shadowMode = process.env['UNIT_TALK_SHADOW_MODE'] ?? '';
  if (shadowMode.includes('routing')) {
    console.error(
      'FATAL: UNIT_TALK_SHADOW_MODE includes "routing" — model-driven takes the shadow path and is NOT braked. Proof cannot run under this configuration.',
    );
    process.exit(1);
  }

  const sources: BrakeSource[] = ['system-pick-scanner', 'alert-agent', 'model-driven'];
  const submissions: SubmissionResult[] = [];
  for (const source of sources) {
    const result = await submitPick(source);
    submissions.push(result);
    console.log(
      `submitted source=${source} http=${result.httpStatus} pickId=${result.pickId ?? '<none>'} lifecycleState=${result.lifecycleState ?? '<none>'} governanceBrake=${result.governanceBrake ?? '<none>'} outboxEnqueued=${result.outboxEnqueued ?? '<none>'}`,
    );
  }
  console.log('');

  // Brief wait to let the controller audit row hit the DB (synchronous in code,
  // but REST read-after-write occasionally lags by a few ms in practice).
  await new Promise((r) => setTimeout(r, 500));

  const results: AssertionResult[] = [
    await assertA1(submissions),
    await assertA2(submissions),
    await assertA3(submissions),
  ];

  let passed = 0;
  let failed = 0;
  for (const r of results) {
    console.log(JSON.stringify(r));
    if (r.result === 'PASS') passed++;
    else failed++;
  }

  console.log('');
  console.log('Fixtures:');
  for (const s of submissions) {
    console.log(`  source=${s.source} pickId=${s.pickId} fixtureId=${s.fixtureId}`);
  }
  console.log('');

  if (failed === 0) {
    console.log(`RESULT: ${passed}/3 PASS`);
    process.exit(0);
  } else {
    console.log(`RESULT: FAIL (${failed} failure${failed === 1 ? '' : 's'}) — ${passed}/3 PASS`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Proof script fatal error:', err);
  process.exit(1);
});
