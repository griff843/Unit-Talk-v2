/**
 * T1 Live-DB Proof: UTV2-1954 promotion replay reproduces the market-adjusted score
 *
 * The promotion score a pick is persisted with includes the market-family
 * multipliers and caps, which depend on the pick's market and sport. Before
 * UTV2-1954 the snapshot in `pick_promotion_history.payload` stored neither, so
 * `replayPromotion()` scored without them and could re-decide a pick: the
 * independent review of #1630 found an eager-path NBA player prop persisted
 * best-bets `suppressed` at 60.15 that replayed `qualified` at 70.76.
 *
 * This proof submits real picks through the real controller against the staging
 * database, reads every promotion history row back out of Postgres -- so the
 * payload has made the JSONB round trip -- and replays each one with nothing but
 * what the row recorded: its snapshot, its scoring context and its saved policy.
 *
 * FIXTURES
 * --------
 * Every pick is Track Only, so no outbox row is written, and is tagged
 * `proof_issue: UTV2-1954` plus a run id. The picks are evidence and are NOT
 * deleted. No row this file did not create is read for an assertion or mutated.
 *
 * Gated on SUPABASE_SERVICE_ROLE_KEY and executed by the
 * `Writable DB proof (staging only)` job via `pnpm test:t1-proof:live`.
 *
 * Run: UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-utv2-1954-promotion-replay.test.ts
 */

import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import { parsePromotionSnapshot, type SubmissionPayload } from '@unit-talk/contracts';
import {
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  type RepositoryBundle,
} from '@unit-talk/db';
import { replayRecordedPromotion } from '@unit-talk/domain';
import { submitPickController } from './controllers/submit-pick-controller.js';

function hasSupabaseEnv(): boolean {
  try {
    const env = loadEnvironment();
    return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  } catch {
    return false;
  }
}

const skipReason = hasSupabaseEnv()
  ? false
  : 'SUPABASE_SERVICE_ROLE_KEY not configured — skipping live DB proof';

const RUN_ID = randomUUID().slice(0, 8);

let repositories: RepositoryBundle;
let supabaseUrl: string;
let serviceRoleKey: string;

before(() => {
  if (skipReason) return;
  const env = loadEnvironment();
  supabaseUrl = env.SUPABASE_URL!;
  serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY!;
  repositories = createDatabaseRepositoryBundle(createServiceRoleDatabaseConnectionConfig(env));
});

async function restQuery<T>(path: string): Promise<T[]> {
  const resp = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
  });
  const body = await resp.json();
  if (!resp.ok) throw new Error(`GET ${path} failed: ${JSON.stringify(body)}`);
  return body as T[];
}

interface HistoryRow {
  id: string;
  target: string;
  status: string;
  // numeric(5,2): PostgREST may return it as a JSON number or as decimal text.
  score: number | string | null;
  decided_at: string;
  override_action: string | null;
  payload: Record<string, unknown>;
}

async function submitTrackOnly(
  label: string,
  market: string,
  sport: string,
  promotionScores: Record<string, number>,
): Promise<{ pickId: string; rows: HistoryRow[] }> {
  const payload: SubmissionPayload = {
    source: 'api',
    market,
    selection: `UTV2-1954 ${label} ${RUN_ID} Over 25.5`,
    odds: -110,
    confidence: 0.7,
    metadata: {
      sport,
      // A real pick names its game. Without one, getPromotionBoardState counts
      // every other eventName-less pick on the target's board as the same game
      // (undefined === undefined), so the per-game cap reflects unrelated CI
      // fixtures rather than this pick. The in-memory fixture carries one too.
      eventName: `UTV2-1954 ${label} ${RUN_ID} Away at Home`,
      distributionMode: 'track-only',
      promotionScores,
      proof_run: RUN_ID,
      proof_issue: 'UTV2-1954',
    },
  };
  const response = await submitPickController(payload, repositories);
  assert.equal(response.status, 201, `${label}: submission expected 201, got ${response.status}`);
  const data = (response.body as { ok: true; data: { pickId: string; outboxEnqueued: boolean } }).data;
  assert.equal(data.outboxEnqueued, false, `${label}: a Track Only submission must not enqueue delivery`);

  const rows = await restQuery<HistoryRow>(
    `pick_promotion_history?pick_id=eq.${data.pickId}` +
      '&select=id,target,status,score,decided_at,override_action,payload&order=target.asc',
  );
  // Asserted, not assumed: a proof that returned early here would pass having
  // replayed nothing.
  assert.equal(rows.length, 3, `${label}: one persisted history row per policy, got ${rows.length}`);

  const outbox = await restQuery<{ id: string }>(`distribution_outbox?pick_id=eq.${data.pickId}&select=id`);
  assert.equal(outbox.length, 0, `${label}: no outbox row`);
  return { pickId: data.pickId, rows };
}

/**
 * Why a recorded decision has the status it has: its suppression reasons and
 * the board state it was evaluated against. Attached to every status assertion
 * so a staging failure names the gate that fired.
 */
function decisionContext(row: HistoryRow): string {
  const explanation = row.payload['explanation'] as { suppressionReasons?: unknown } | undefined;
  return JSON.stringify({
    status: row.status,
    suppressionReasons: explanation?.suppressionReasons ?? null,
    boardStateAtDecision: row.payload['boardStateAtDecision'] ?? null,
  });
}

function assertRowReproduces(label: string, row: HistoryRow) {
  // The helper is handed the row's own score column, exactly as PostgREST
  // returned it, so `agrees` covers the column and not only payload.score.
  const replay = replayRecordedPromotion(row.payload, { status: row.status, decidedAt: row.decided_at, score: row.score });
  assert.equal(replay.outcome, 'replayed', `${label}/${row.target}: reproducible (${JSON.stringify(replay)})`);
  if (replay.outcome !== 'replayed') return replay;
  assert.equal(replay.decision.score, row.payload['score'], `${label}/${row.target}: exact recorded score`);
  assert.equal(
    replay.persistedScoreMatches,
    true,
    `${label}/${row.target}: agrees with the numeric(5,2) score column ${row.score} (replayed ${replay.decision.score} -> ${replay.replayedColumnScore})`,
  );
  assert.equal(replay.decision.status, row.status, `${label}/${row.target}: recorded status ${decisionContext(row)}`);
  assert.deepEqual(replay.disagreements, [], `${label}/${row.target}: no field disagrees`);
  assert.equal(replay.agrees, true, `${label}/${row.target}: replay agrees`);
  return replay;
}

test('UTV2-1954 live-DB: the reported NBA prop replays suppressed at 60.15, not qualified at 70.76', { skip: skipReason }, async () => {
  const { rows } = await submitTrackOnly('nba-prop', 'NBA - Player Points', 'NBA', {
    edge: 72.5,
    trust: 72.5,
    readiness: 72.5,
    uniqueness: 72.5,
    boardFit: 72.5,
  });
  const bestBets = rows.find((row) => row.target === 'best-bets');
  assert.ok(bestBets, 'a best-bets row was persisted');
  assert.equal(bestBets.status, 'suppressed', `nba-prop/best-bets: ${decisionContext(bestBets)}`);
  assert.equal(Number(Number(bestBets.payload['score']).toFixed(2)), 60.15);
  const explanation = bestBets.payload['explanation'] as { suppressionReasons: string[] };
  assert.deepEqual(explanation.suppressionReasons, ['promotion score 60.15 is below threshold 70.00']);
  assert.deepEqual(parsePromotionSnapshot(bestBets.payload)?.scoringContext, {
    market: 'NBA - Player Points',
    sport: 'NBA',
  });

  const replay = assertRowReproduces('nba-prop', bestBets);
  assert.equal(replay.outcome, 'replayed');
  if (replay.outcome !== 'replayed') return;
  assert.equal(replay.decision.qualified, false);
  assert.equal(Number(replay.decision.score.toFixed(2)), 60.15);
  assert.deepEqual(replay.decision.explanation.suppressionReasons, explanation.suppressionReasons);

  for (const row of rows) assertRowReproduces('nba-prop', row);
});

test('UTV2-1954 live-DB: a qualifying canonical player prop replays qualified at its recorded score', { skip: skipReason }, async () => {
  const { rows } = await submitTrackOnly('nba-prop-qualified', 'player.points', 'NBA', {
    edge: 80,
    trust: 80,
    readiness: 85,
    uniqueness: 82,
    boardFit: 83,
  });
  const bestBets = rows.find((row) => row.target === 'best-bets');
  assert.ok(bestBets);
  assert.equal(bestBets.status, 'qualified', `nba-prop-qualified/best-bets: ${decisionContext(bestBets)}`);
  for (const row of rows) assertRowReproduces('nba-prop-qualified', row);
});

test('UTV2-1954 live-DB: a game line and an unsupported sport replay at their recorded scores', { skip: skipReason }, async () => {
  const gameLine = await submitTrackOnly('mlb-moneyline', 'moneyline', 'MLB', {
    edge: 30,
    trust: 30,
    readiness: 35,
    uniqueness: 30,
    boardFit: 35,
  });
  for (const row of gameLine.rows) assertRowReproduces('mlb-moneyline', row);

  const unsupported = await submitTrackOnly('wnba-moneyline', 'moneyline', 'WNBA', {
    edge: 85,
    trust: 85,
    readiness: 85,
    uniqueness: 85,
    boardFit: 85,
  });
  for (const row of unsupported.rows) {
    assertRowReproduces('wnba-moneyline', row);
    // The unsupported-sport cap is part of what replay must reproduce.
    assert.ok(Number(row.payload['score']) <= 60, `${row.target}: capped at 60 for an unsupported sport`);
  }
});

test('UTV2-1954 live-DB: a persisted row stripped of its scoring context is not reproducible', { skip: skipReason }, async () => {
  const { rows } = await submitTrackOnly('legacy-shape', 'NBA - Player Points', 'NBA', {
    edge: 72.5,
    trust: 72.5,
    readiness: 72.5,
    uniqueness: 72.5,
    boardFit: 72.5,
  });
  for (const row of rows) {
    const { scoringContext: _dropped, ...legacyPayload } = row.payload;
    assert.deepEqual(
      replayRecordedPromotion(legacyPayload, { status: row.status, decidedAt: row.decided_at, score: row.score }),
      { outcome: 'not-reproducible', reason: 'scoring-context-missing' },
      `${row.target}: a pre-UTV2-1954 row is never silently re-decided`,
    );
  }
});

test('UTV2-1954 live-DB: a persisted row whose score column disagrees with its payload is a disagreement', { skip: skipReason }, async () => {
  const { rows } = await submitTrackOnly('column-drift', 'NBA - Player Points', 'NBA', {
    edge: 72.5,
    trust: 72.5,
    readiness: 72.5,
    uniqueness: 72.5,
    boardFit: 72.5,
  });
  for (const row of rows) {
    // Control: the row as Postgres returned it reproduces.
    assert.equal(assertRowReproduces('column-drift', row).outcome, 'replayed');
    assert.notEqual(row.score, null, `${row.target}: the column was written`);

    // A deliberately inconsistent row-shaped input built from the real row:
    // payload untouched (so payload.score still matches the replay), only the
    // score column moved by one cent. The helper itself must refuse to agree.
    const drifted: HistoryRow = { ...row, score: Number(row.score) + 0.01 };
    const replay = replayRecordedPromotion(drifted.payload, {
      status: drifted.status,
      decidedAt: drifted.decided_at,
      score: drifted.score,
    });
    assert.equal(replay.outcome, 'replayed', `column-drift/${row.target}: ${JSON.stringify(replay)}`);
    if (replay.outcome !== 'replayed') continue;
    assert.equal(replay.scoreMatches, true, `column-drift/${row.target}: payload.score still matches`);
    assert.equal(replay.statusMatches, true, `column-drift/${row.target}: status still matches`);
    assert.deepEqual(replay.disagreements, ['persisted-score'], `column-drift/${row.target}`);
    assert.equal(replay.agrees, false, `column-drift/${row.target}: the helper disagrees`);

    // And an empty column refuses the replay rather than agreeing.
    assert.deepEqual(
      replayRecordedPromotion(row.payload, { status: row.status, decidedAt: row.decided_at, score: null }),
      { outcome: 'not-reproducible', reason: 'persisted-score-missing' },
      `column-drift/${row.target}: a null column is not reproducible`,
    );
  }
});
