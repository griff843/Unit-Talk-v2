/**
 * UTV2-494 — Phase 7A Governance Brake Proof — Lane C (Review Flow)
 *
 * Proves that the existing review flow coherently advances, rejects, or holds
 * picks parked in `awaiting_approval` by the Phase 7A governance brake
 * (UTV2-486 / UTV2-491 / UTV2-509).
 *
 * Assertions (live DB, project feownrheeefbcsehtsiw):
 *   C1  Approve path:
 *         system-pick-scanner submission -> awaiting_approval
 *         POST /api/picks/:id/review {decision:'approve'}
 *         picks.status = 'queued'
 *         pick_lifecycle row awaiting_approval -> queued, reason contains 'operator_override'
 *         audit_log row action='review.approve' with payload.previousLifecycleState='awaiting_approval'
 *   C2  Deny path:
 *         alert-agent submission -> awaiting_approval
 *         POST /review {decision:'deny'}
 *         picks.status = 'voided'
 *         pick_lifecycle row awaiting_approval -> voided
 *         audit_log row action='review.deny' carries previousLifecycleState
 *   C3  Hold path:
 *         model-driven submission -> awaiting_approval
 *         POST /review {decision:'hold'}
 *         picks.status STILL 'awaiting_approval' (no lifecycle event for that pick)
 *         picks.approval_status = 'pending' (unchanged per review-pick-controller)
 *   C4  Audit coherence:
 *         each of C1/C2/C3 has an audit_log row with entity_ref = pick id and
 *         an action string consistent with the decision (review.<decision>).
 *
 * Run:
 *   npx tsx apps/api/src/scripts/utv2-494-phase7a-proof-c-review.ts
 *
 * Prereq: apps/api running at http://localhost:4000 with persistenceMode=database.
 */

import { loadEnvironment } from '@unit-talk/config';

const env = loadEnvironment();
const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const API_BASE = process.env['API_BASE'] ?? 'http://localhost:4000';

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
  limit = 50,
): Promise<T[]> {
  const qs = new URLSearchParams({ select, limit: String(limit), ...filters }).toString();
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    headers: { ...BASE_HEADERS, Prefer: 'return=representation' },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`supabase ${table} query failed: HTTP ${resp.status}: ${body}`);
  }
  return (await resp.json()) as T[];
}

interface PickRow {
  id: string;
  status: string;
  approval_status: string;
}

interface LifecycleRow {
  id: string;
  pick_id: string;
  from_state: string | null;
  to_state: string;
  reason: string | null;
  writer_role: string | null;
  created_at: string;
}

interface AuditRow {
  id: string;
  entity_type: string;
  entity_id: string;
  entity_ref: string | null;
  action: string;
  actor: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

async function fetchPick(pickId: string): Promise<PickRow | null> {
  const rows = await queryRows<PickRow>('picks', 'id,status,approval_status', {
    id: `eq.${pickId}`,
  }, 1);
  return rows[0] ?? null;
}

async function fetchLifecycleEvents(pickId: string): Promise<LifecycleRow[]> {
  return queryRows<LifecycleRow>(
    'pick_lifecycle',
    'id,pick_id,from_state,to_state,reason,writer_role,created_at',
    { pick_id: `eq.${pickId}`, order: 'created_at.asc' },
    50,
  );
}

async function fetchAuditRows(pickId: string): Promise<AuditRow[]> {
  return queryRows<AuditRow>(
    'audit_log',
    'id,entity_type,entity_id,entity_ref,action,actor,payload,created_at',
    { entity_ref: `eq.${pickId}`, order: 'created_at.asc' },
    50,
  );
}

// ---------------------------------------------------------------------------
// HTTP helpers against apps/api
// ---------------------------------------------------------------------------

interface SubmitResponseOk {
  ok: true;
  data: {
    pickId: string;
    lifecycleState?: string;
    governanceBrake?: boolean;
    outboxEnqueued?: boolean;
  };
}

interface SubmitResponseErr {
  ok: false;
  error: { code: string; message: string };
}

async function submitPick(
  source: string,
  fixtureId: string,
): Promise<string> {
  const payload = {
    source,
    market: 'NBA points',
    selection: `Player Over 18.5 (${fixtureId})`,
    line: 18.5,
    odds: -110,
    stakeUnits: 1,
    confidence: 0.7,
    metadata: {
      proof_fixture_id: fixtureId,
      proof_script: 'utv2-494-lane-c',
    },
  };
  const resp = await fetch(`${API_BASE}/api/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  let body: SubmitResponseOk | SubmitResponseErr;
  try {
    body = JSON.parse(text) as SubmitResponseOk | SubmitResponseErr;
  } catch {
    throw new Error(`submission response not JSON (HTTP ${resp.status}): ${text}`);
  }
  if (!body.ok) {
    throw new Error(`submission failed [${source}]: ${body.error.code} ${body.error.message}`);
  }
  return body.data.pickId;
}

async function reviewPick(
  pickId: string,
  decision: 'approve' | 'deny' | 'hold',
  reason: string,
  decidedBy: string,
): Promise<{ status: number; body: unknown }> {
  const resp = await fetch(`${API_BASE}/api/picks/${pickId}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, reason, decidedBy }),
  });
  const text = await resp.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: resp.status, body };
}

// ---------------------------------------------------------------------------
// Assertion framework
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

// ---------------------------------------------------------------------------
// Lane state collected as we run the three cases (approve, deny, hold).
// Lane C4 depends on audit rows captured alongside C1/C2/C3.
// ---------------------------------------------------------------------------

interface LaneState {
  pickId: string;
  fixtureId: string;
  source: string;
  reviewResponse?: { status: number; body: unknown };
  postPick?: PickRow | null;
  lifecycle?: LifecycleRow[];
  auditRows?: AuditRow[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(JSON.stringify({ event: 'proof_start', script: 'utv2-494-lane-c', api: API_BASE, db: SUPABASE_URL }));

  const results: AssertionResult[] = [];
  const ts = Date.now();

  // -----------------------------------------------------------------------
  // C1 — Approve path (system-pick-scanner)
  // -----------------------------------------------------------------------
  const approveLane: LaneState = {
    source: 'system-pick-scanner',
    fixtureId: `utv2-494-lane-c-approve-${ts}`,
    pickId: '',
  };
  try {
    approveLane.pickId = await submitPick(approveLane.source, approveLane.fixtureId);

    // Verify parked in awaiting_approval before review
    const parked = await fetchPick(approveLane.pickId);
    if (!parked || parked.status !== 'awaiting_approval') {
      results.push(fail('C1: approve path (system-pick-scanner -> queued)', {
        reason: 'submission did not land in awaiting_approval',
        pickId: approveLane.pickId,
        parked,
      }));
    } else {
      approveLane.reviewResponse = await reviewPick(
        approveLane.pickId,
        'approve',
        'proof c1 operator approval',
        'utv2-494-lane-c',
      );

      approveLane.postPick = await fetchPick(approveLane.pickId);
      approveLane.lifecycle = await fetchLifecycleEvents(approveLane.pickId);
      approveLane.auditRows = await fetchAuditRows(approveLane.pickId);

      const transition = (approveLane.lifecycle ?? []).find(
        (ev) => ev.from_state === 'awaiting_approval' && ev.to_state === 'queued',
      );
      const approveAudit = (approveLane.auditRows ?? []).find(
        (row) => row.action === 'review.approve',
      );
      const prevStateInAudit =
        approveAudit?.payload && typeof approveAudit.payload === 'object'
          ? (approveAudit.payload as Record<string, unknown>)['previousLifecycleState']
          : undefined;

      const okStatus = approveLane.postPick?.status === 'queued';
      const okTransition = !!transition && transition.writer_role === 'operator_override';
      const okAudit = !!approveAudit && prevStateInAudit === 'awaiting_approval';

      if (okStatus && okTransition && okAudit && approveLane.reviewResponse.status === 200) {
        results.push(pass('C1: approve path (system-pick-scanner -> queued)', {
          pickId: approveLane.pickId,
          reviewHttpStatus: approveLane.reviewResponse.status,
          postStatus: approveLane.postPick?.status,
          transition: {
            from_state: transition.from_state,
            to_state: transition.to_state,
            writer_role: transition.writer_role,
            reason: transition.reason,
          },
          auditAction: approveAudit.action,
          previousLifecycleState: prevStateInAudit,
        }));
      } else {
        results.push(fail('C1: approve path (system-pick-scanner -> queued)', {
          pickId: approveLane.pickId,
          reviewHttpStatus: approveLane.reviewResponse.status,
          reviewBody: approveLane.reviewResponse.body,
          postStatus: approveLane.postPick?.status,
          okStatus,
          okTransition,
          okAudit,
          transition,
          approveAudit,
          lifecycleCount: approveLane.lifecycle?.length,
          auditCount: approveLane.auditRows?.length,
        }));
      }
    }
  } catch (err) {
    results.push(fail('C1: approve path (system-pick-scanner -> queued)', {
      error: err instanceof Error ? err.message : String(err),
      pickId: approveLane.pickId,
    }));
  }
  console.log(JSON.stringify(results[results.length - 1]));

  // -----------------------------------------------------------------------
  // C2 — Deny path (alert-agent)
  // -----------------------------------------------------------------------
  const denyLane: LaneState = {
    source: 'alert-agent',
    fixtureId: `utv2-494-lane-c-deny-${ts}`,
    pickId: '',
  };
  try {
    denyLane.pickId = await submitPick(denyLane.source, denyLane.fixtureId);

    const parked = await fetchPick(denyLane.pickId);
    if (!parked || parked.status !== 'awaiting_approval') {
      results.push(fail('C2: deny path (alert-agent -> voided)', {
        reason: 'submission did not land in awaiting_approval',
        pickId: denyLane.pickId,
        parked,
      }));
    } else {
      denyLane.reviewResponse = await reviewPick(
        denyLane.pickId,
        'deny',
        'proof c2 operator denial',
        'utv2-494-lane-c',
      );
      denyLane.postPick = await fetchPick(denyLane.pickId);
      denyLane.lifecycle = await fetchLifecycleEvents(denyLane.pickId);
      denyLane.auditRows = await fetchAuditRows(denyLane.pickId);

      const transition = (denyLane.lifecycle ?? []).find(
        (ev) => ev.from_state === 'awaiting_approval' && ev.to_state === 'voided',
      );
      const denyAudit = (denyLane.auditRows ?? []).find(
        (row) => row.action === 'review.deny',
      );
      const prevStateInAudit =
        denyAudit?.payload && typeof denyAudit.payload === 'object'
          ? (denyAudit.payload as Record<string, unknown>)['previousLifecycleState']
          : undefined;

      const okStatus = denyLane.postPick?.status === 'voided';
      const okTransition = !!transition && transition.writer_role === 'operator_override';
      const okAudit = !!denyAudit && prevStateInAudit === 'awaiting_approval';

      if (okStatus && okTransition && okAudit && denyLane.reviewResponse.status === 200) {
        results.push(pass('C2: deny path (alert-agent -> voided)', {
          pickId: denyLane.pickId,
          reviewHttpStatus: denyLane.reviewResponse.status,
          postStatus: denyLane.postPick?.status,
          transition: {
            from_state: transition.from_state,
            to_state: transition.to_state,
            writer_role: transition.writer_role,
            reason: transition.reason,
          },
          auditAction: denyAudit.action,
          previousLifecycleState: prevStateInAudit,
        }));
      } else {
        results.push(fail('C2: deny path (alert-agent -> voided)', {
          pickId: denyLane.pickId,
          reviewHttpStatus: denyLane.reviewResponse.status,
          reviewBody: denyLane.reviewResponse.body,
          postStatus: denyLane.postPick?.status,
          okStatus,
          okTransition,
          okAudit,
          transition,
          denyAudit,
          lifecycleCount: denyLane.lifecycle?.length,
          auditCount: denyLane.auditRows?.length,
        }));
      }
    }
  } catch (err) {
    results.push(fail('C2: deny path (alert-agent -> voided)', {
      error: err instanceof Error ? err.message : String(err),
      pickId: denyLane.pickId,
    }));
  }
  console.log(JSON.stringify(results[results.length - 1]));

  // -----------------------------------------------------------------------
  // C3 — Hold path (model-driven)
  // -----------------------------------------------------------------------
  const holdLane: LaneState = {
    source: 'model-driven',
    fixtureId: `utv2-494-lane-c-hold-${ts}`,
    pickId: '',
  };
  try {
    holdLane.pickId = await submitPick(holdLane.source, holdLane.fixtureId);

    const parked = await fetchPick(holdLane.pickId);
    if (!parked || parked.status !== 'awaiting_approval') {
      results.push(fail('C3: hold path (model-driven stays awaiting_approval)', {
        reason: 'submission did not land in awaiting_approval',
        pickId: holdLane.pickId,
        parked,
      }));
    } else {
      // Capture the pre-review approval_status so the hold assertion can check
      // that it is left UNCHANGED by the review controller (Option A writeback
      // per UTV2-521: decisionToApprovalStatus('hold') returns null → no change).
      // Brake picks enter with approval_status='approved' as the post-promotion
      // default, so the correct assertion is "unchanged from pre-review value",
      // NOT "equals 'pending'".
      const preReviewApprovalStatus = parked.approval_status;
      holdLane.reviewResponse = await reviewPick(
        holdLane.pickId,
        'hold',
        'proof c3 operator hold',
        'utv2-494-lane-c',
      );
      holdLane.postPick = await fetchPick(holdLane.pickId);
      holdLane.lifecycle = await fetchLifecycleEvents(holdLane.pickId);
      holdLane.auditRows = await fetchAuditRows(holdLane.pickId);

      // No lifecycle transition should be driven from awaiting_approval by hold.
      const offendingTransition = (holdLane.lifecycle ?? []).find(
        (ev) => ev.from_state === 'awaiting_approval' && ev.to_state !== 'awaiting_approval',
      );

      // approval_status must be unchanged by hold
      // (decisionToApprovalStatus: hold -> null = no change)
      const okStatus = holdLane.postPick?.status === 'awaiting_approval';
      const okApproval = holdLane.postPick?.approval_status === preReviewApprovalStatus;
      const okNoTransition = !offendingTransition;
      const holdAudit = (holdLane.auditRows ?? []).find(
        (row) => row.action === 'review.hold',
      );
      const okAudit = !!holdAudit;

      if (okStatus && okApproval && okNoTransition && okAudit && holdLane.reviewResponse.status === 200) {
        results.push(pass('C3: hold path (model-driven stays awaiting_approval)', {
          pickId: holdLane.pickId,
          reviewHttpStatus: holdLane.reviewResponse.status,
          postStatus: holdLane.postPick?.status,
          postApprovalStatus: holdLane.postPick?.approval_status,
          lifecycleEventCount: holdLane.lifecycle?.length ?? 0,
          auditAction: holdAudit.action,
        }));
      } else {
        results.push(fail('C3: hold path (model-driven stays awaiting_approval)', {
          pickId: holdLane.pickId,
          reviewHttpStatus: holdLane.reviewResponse.status,
          reviewBody: holdLane.reviewResponse.body,
          postStatus: holdLane.postPick?.status,
          postApprovalStatus: holdLane.postPick?.approval_status,
          okStatus,
          okApproval,
          okNoTransition,
          okAudit,
          offendingTransition,
          holdAudit,
          lifecycle: holdLane.lifecycle,
        }));
      }
    }
  } catch (err) {
    results.push(fail('C3: hold path (model-driven stays awaiting_approval)', {
      error: err instanceof Error ? err.message : String(err),
      pickId: holdLane.pickId,
    }));
  }
  console.log(JSON.stringify(results[results.length - 1]));

  // -----------------------------------------------------------------------
  // C4 — Audit coherence: each lane has an audit row with entity_ref = pickId
  //      and an action string that matches review.<decision>.
  // -----------------------------------------------------------------------
  try {
    const lanes: { lane: string; pickId: string; expectedAction: string; audit: AuditRow[] | undefined }[] = [
      { lane: 'C1-approve', pickId: approveLane.pickId, expectedAction: 'review.approve', audit: approveLane.auditRows },
      { lane: 'C2-deny', pickId: denyLane.pickId, expectedAction: 'review.deny', audit: denyLane.auditRows },
      { lane: 'C3-hold', pickId: holdLane.pickId, expectedAction: 'review.hold', audit: holdLane.auditRows },
    ];

    const missing: Array<Record<string, unknown>> = [];
    const observedActions: Record<string, string[]> = {};

    for (const l of lanes) {
      const rows = l.audit ?? [];
      observedActions[l.lane] = rows.map((r) => r.action);
      const match = rows.find(
        (row) => row.action === l.expectedAction && row.entity_ref === l.pickId,
      );
      if (!match) {
        missing.push({
          lane: l.lane,
          pickId: l.pickId,
          expectedAction: l.expectedAction,
          observedActions: rows.map((r) => r.action),
        });
      }
    }

    if (missing.length === 0) {
      results.push(pass('C4: audit coherence across approve/deny/hold', {
        observedActions,
        actionsConfirmed: ['review.approve', 'review.deny', 'review.hold'],
      }));
    } else {
      results.push(fail('C4: audit coherence across approve/deny/hold', {
        missing,
        observedActions,
      }));
    }
  } catch (err) {
    results.push(fail('C4: audit coherence across approve/deny/hold', {
      error: err instanceof Error ? err.message : String(err),
    }));
  }
  console.log(JSON.stringify(results[results.length - 1]));

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  const passCount = results.filter((r) => r.result === 'PASS').length;
  const total = results.length;

  console.log(JSON.stringify({
    event: 'proof_summary',
    script: 'utv2-494-lane-c',
    pickIds: {
      approve: approveLane.pickId,
      deny: denyLane.pickId,
      hold: holdLane.pickId,
    },
    fixtureIds: {
      approve: approveLane.fixtureId,
      deny: denyLane.fixtureId,
      hold: holdLane.fixtureId,
    },
    results,
  }, null, 2));

  console.log(`RESULT: ${passCount}/${total} PASS`);

  if (passCount !== total) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FATAL:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
