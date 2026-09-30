/**
 * T1 Live-DB Proof: an explicit Track Only request stays Track Only
 * (WORK-2026092802)
 *
 * The defect this proves fixed was found in production, not in a test. On
 * 2026-09-28 griff843 -- on the human-capper delivery allow-list -- submitted
 * pick c12f1e2f through the deployed Smart Form with
 * `distributionMode: 'track-only'`. The API rewrote the mode to
 * `delivery-eligible`, recorded an `authorized` decision and queued an outbox
 * row for `discord:official-picks`. Only the killed switch stopped the post.
 *
 * The in-memory suite (`t1-proof-utv2-1923-human-capper-delivery.test.ts`,
 * section 7) proves the handler logic and carries the mutation control that
 * restores the pre-fix block. What it cannot prove is that the persisted rows
 * say so, because in memory nothing is persisted. This file drives the real
 * handler against the real staging tables under the posture that makes
 * delivery MOST reachable -- posture on, capper allow-listed, target released,
 * the capper's own picks destination configured -- and reads the result back
 * through PostgREST, not through the object the handler returned:
 *
 *   1. The production request shape persists `track-only`, records the
 *      `track-only-requested` refusal, and has zero `distribution_outbox`,
 *      zero `distribution_receipts` and zero `execution_intents` rows.
 *   2. The same capper under the same posture asking for `delivery-eligible`
 *      still gets exactly one pending outbox row on the governed human target.
 *      The fix must not have disabled the capability.
 *   3. A capper NOT on the allow-list asking for `delivery-eligible` is refused
 *      with 403 and persists no pick at all.
 *
 * Fixture honesty. The capper is run-namespaced and seeded here; it is not
 * griff843, and its Discord destination is a fixture snowflake, never a real
 * channel. The participant resolution is the manual `canonical-coverage-gap`
 * path with invented, run-namespaced team names, because staging carries no
 * canonical team catalog to resolve a real matchup against; the production pick
 * used the canonical path. The defect lived entirely in the handler's
 * mode/authorization decision, which reads neither the resolution nor the
 * event, so the difference does not bear on what is proven. No worker runs
 * against staging, so the pending row in (2) is never delivered anywhere.
 *
 * Isolation: `CI_FIXTURE_RUN_ID` namespaces every identifier. Rows are NOT
 * deleted, matching every other T1 live proof. In the credentialed CI job a
 * missing credential is a RED test, never a skip.
 *
 * Run ONLY through `pnpm test:t1-proof:live`, whose `&&` chain begins with
 * `pnpm ci:assert-staging`. That guard is what pins the target to the staging
 * project, as for the sibling proofs in the chain (`apps/api` cannot import
 * the guard: its `rootDir` is `src`). As a second, narrower belt this file
 * refuses outright to construct a client against the production project.
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { loadEnvironment } from '@unit-talk/config';
import {
  humanDeliveryTargets,
  isHumanCapperDeliveryAuthorized,
  isMemberVisibleOfficialPick,
  readHumanCapperDeliveryAuthorization,
} from '@unit-talk/contracts';
import {
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  type RepositoryBundle,
} from '@unit-talk/db';

import { handleSubmitPick } from './handlers/submit-pick.js';

function readEnv(): ReturnType<typeof loadEnvironment> | null {
  try {
    return loadEnvironment();
  } catch {
    return null;
  }
}

const env = readEnv() as (ReturnType<typeof loadEnvironment> & Record<string, string | undefined>) | null;
const hasCredential = Boolean(env && env['SUPABASE_URL'] && env['SUPABASE_SERVICE_ROLE_KEY']);
const PRODUCTION_PROJECT_REF = 'zfzdnfwdarxucxtaojxm';
const ciFixtureRunId = process.env['CI_FIXTURE_RUN_ID'];
const mustRun = Boolean(ciFixtureRunId);

const skipReason = mustRun
  ? false
  : hasCredential && /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/u.test(env?.['SUPABASE_URL'] ?? '')
    ? false
    : 'no hosted Supabase target configured — skipping live DB proof';

const RUN_NAMESPACE = (ciFixtureRunId ?? `local-${randomUUID().slice(0, 8)}`)
  .replace(/[^A-Za-z0-9-]/g, '-')
  .slice(0, 48);

const CAPPER = `t1-proof-2801-${RUN_NAMESPACE}`.toLowerCase();
const OUTSIDER = `t1-proof-2801-outsider-${RUN_NAMESPACE}`.toLowerCase();
const HUMAN_DELIVERY_TARGET = `discord:${humanDeliveryTargets[0]}`;

// Fixture snowflakes, never a real guild or channel.
const GUILD_ID = '100000000000000001';
const PICKS_CHANNEL_ID = '100000000000000002';
const DISCUSSION_CHANNEL_ID = '100000000000000003';
const RESERVED_CAPPER_CHANNEL_ID = '100000000000000004';

/** Posture on, capper allow-listed, human target released: delivery maximally reachable. */
const PRODUCTION_POSTURE: Record<string, string> = {
  UNIT_TALK_HUMAN_CAPPER_DELIVERY_ENABLED: 'true',
  UNIT_TALK_HUMAN_CAPPER_DELIVERY_ALLOWLIST: CAPPER,
  UNIT_TALK_ENABLED_TARGETS: humanDeliveryTargets[0],
  UNIT_TALK_APP_ENV: 'production',
  DISCORD_GUILD_ID: GUILD_ID,
  DISCORD_CAPPER_CHANNEL_ID: RESERVED_CAPPER_CHANNEL_ID,
};

let repositories: RepositoryBundle;
let supabaseUrl: string;
let serviceRoleKey: string;

before(async () => {
  if (skipReason) return;
  assert.ok(env, 'environment failed to load, so the target cannot be identified');
  assert.ok(
    hasCredential,
    'CI_FIXTURE_RUN_ID is set, so this run must reach staging, but SUPABASE_URL/' +
      'SUPABASE_SERVICE_ROLE_KEY are not configured. Failing rather than skipping.',
  );
  supabaseUrl = env['SUPABASE_URL']!;
  assert.ok(
    !supabaseUrl.includes(PRODUCTION_PROJECT_REF),
    'refusing to write proof fixtures to the production project',
  );
  serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY']!;
  repositories = createDatabaseRepositoryBundle(createServiceRoleDatabaseConnectionConfig(env));

  for (const id of [CAPPER, OUTSIDER]) {
    await restUpsert('cappers', {
      id,
      display_name: `WORK-2026092802 proof capper ${id}`,
      active: true,
      metadata: {
        discord: {
          guildId: GUILD_ID,
          picksChannelId: PICKS_CHANNEL_ID,
          discussionChannelId: DISCUSSION_CHANNEL_ID,
        },
      },
    });
  }
});

function restHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function restQuery<T>(path: string): Promise<T[]> {
  const resp = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers: restHeaders() });
  const body = await resp.json();
  if (!resp.ok) throw new Error(`GET ${path} failed: ${JSON.stringify(body)}`);
  return body as T[];
}

async function restUpsert(table: string, row: Record<string, unknown>): Promise<void> {
  const resp = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: restHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify([row]),
  });
  if (!resp.ok) throw new Error(`UPSERT ${table} failed: ${resp.status} ${await resp.text()}`);
}

async function withEnv<T>(overrides: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function body(capperId: string, label: string, distributionMode: string) {
  const teams = `Northgate Foundry ${RUN_NAMESPACE} at Southport Ironworks ${RUN_NAMESPACE}`;
  return {
    source: 'smart-form',
    market: 'NFL moneyline',
    selection: `Northgate Foundry ${RUN_NAMESPACE} ML ${label}`,
    odds: -110,
    stakeUnits: 0.5,
    confidence: 0.7,
    eventName: `${teams} (${label})`,
    metadata: {
      sport: 'NFL',
      capper: capperId,
      distributionMode,
      proof_issue: 'WORK-2026092802',
      proof_run: RUN_NAMESPACE,
      participantResolution: {
        resolution: 'manual',
        sportId: 'NFL',
        eventId: null,
        manualOverride: true,
        reason: 'canonical-coverage-gap',
        enteredEventName: `${teams} (${label})`,
        enteredParticipants: [
          { role: 'away', displayName: `Northgate Foundry ${RUN_NAMESPACE}`, canonicalParticipantId: null },
          { role: 'home', displayName: `Southport Ironworks ${RUN_NAMESPACE}`, canonicalParticipantId: null },
        ],
      },
    },
  };
}

function auth(capperId: string) {
  return { role: 'capper' as const, capperId, identity: capperId };
}

interface PickRow {
  id: string;
  status: string;
  source: string;
  metadata: Record<string, unknown>;
}

async function readPick(pickId: string): Promise<PickRow> {
  const rows = await restQuery<PickRow>(`picks?id=eq.${pickId}&select=id,status,source,metadata`);
  assert.equal(rows.length, 1, `pick ${pickId} must exist`);
  return rows[0]!;
}

async function deliveryArtifacts(pickId: string) {
  const outbox = await restQuery<{ id: string; target: string; status: string }>(
    `distribution_outbox?pick_id=eq.${pickId}&select=id,target,status`,
  );
  const receipts =
    outbox.length === 0
      ? []
      : await restQuery<{ id: string }>(
          `distribution_receipts?outbox_id=in.(${outbox.map((row) => row.id).join(',')})&select=id`,
        );
  const intents = await restQuery<{ id: string }>(`execution_intents?pick_id=eq.${pickId}&select=id`);
  return { outbox, receipts, intents };
}

test(
  'WORK-2026092802 live: the production request shape persists Track Only with zero delivery artifacts',
  { skip: skipReason },
  async () => {
    const response = await withEnv(PRODUCTION_POSTURE, () =>
      handleSubmitPick({ body: body(CAPPER, 'track-only', 'track-only'), auth: auth(CAPPER) }, repositories),
    );
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.ok(response.body.ok);
    if (!response.body.ok) return;
    assert.equal(response.body.data.deliveryPosture, 'track-only');
    assert.equal(response.body.data.outboxEnqueued, false);

    const pick = await readPick(response.body.data.pickId);
    assert.equal(pick.source, 'smart-form');
    assert.notEqual(pick.status, 'queued', 'a Track Only pick is never queued');
    assert.equal(pick.metadata['distributionMode'], 'track-only', 'persisted mode, read from the database');
    assert.equal(isHumanCapperDeliveryAuthorized(pick.metadata), false);
    const authorization = readHumanCapperDeliveryAuthorization(pick.metadata);
    assert.equal(authorization?.decision, 'refused');
    assert.equal(authorization?.reason, 'track-only-requested');
    assert.equal(authorization?.capperId, CAPPER);

    const artifacts = await deliveryArtifacts(pick.id);
    assert.equal(artifacts.outbox.length, 0, 'zero distribution_outbox rows');
    assert.equal(artifacts.receipts.length, 0, 'zero distribution_receipts rows');
    assert.equal(artifacts.intents.length, 0, 'zero execution_intents rows');
  },
);

test(
  'WORK-2026092802 live: the same capper explicitly asking for delivery still gets one governed outbox row',
  { skip: skipReason },
  async () => {
    const response = await withEnv(PRODUCTION_POSTURE, () =>
      handleSubmitPick(
        { body: body(CAPPER, 'delivery', 'delivery-eligible'), auth: auth(CAPPER) },
        repositories,
      ),
    );
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.ok(response.body.ok);
    if (!response.body.ok) return;
    assert.equal(response.body.data.deliveryPosture, 'delivered');

    const pick = await readPick(response.body.data.pickId);
    assert.equal(pick.metadata['distributionMode'], 'delivery-eligible');
    assert.equal(isHumanCapperDeliveryAuthorized(pick.metadata), true);
    assert.equal(readHumanCapperDeliveryAuthorization(pick.metadata)?.capperId, CAPPER);

    const artifacts = await deliveryArtifacts(pick.id);
    assert.equal(artifacts.outbox.length, 1, 'exactly one delivery row');
    assert.equal(artifacts.outbox[0]?.target, HUMAN_DELIVERY_TARGET);
    assert.equal(artifacts.outbox[0]?.status, 'pending');
    assert.equal(artifacts.receipts.length, 0, 'nothing has been delivered; no worker runs against staging');
  },
);

test(
  'WORK-2026092802 live: a capper not on the allow-list asking for delivery is refused and persists nothing',
  { skip: skipReason },
  async () => {
    const label = 'outsider-delivery';
    const response = await withEnv(PRODUCTION_POSTURE, () =>
      handleSubmitPick(
        { body: body(OUTSIDER, label, 'delivery-eligible'), auth: auth(OUTSIDER) },
        repositories,
      ),
    );
    assert.equal(response.status, 403);
    assert.ok(!response.body.ok);
    if (!response.body.ok) assert.equal(response.body.error.code, 'CAPPER_TRACK_ONLY_REQUIRED');

    const selection = encodeURIComponent(`Northgate Foundry ${RUN_NAMESPACE} ML ${label}`);
    const rows = await restQuery<{ id: string }>(`picks?selection=eq.${selection}&select=id`);
    assert.equal(rows.length, 0, 'a refused request persists no pick');
  },
);

// ---------------------------------------------------------------------------
// WORK-2026092901: the member read and the dispatch-ledger read, against real
// Postgres. Both are READ-ONLY. The JSON-path filters behind
// listMemberVisibleOfficialPicks and the prefix filter behind listByEntity are
// only checked by PostgREST at run time, so an in-memory test cannot prove them.
// ---------------------------------------------------------------------------

test(
  'WORK-2026092901 live: the member read returns only member-visible official picks, never this run\'s Track Only or queued fixtures',
  { skip: skipReason },
  async () => {
    const reader = repositories.picks.listMemberVisibleOfficialPicks;
    assert.ok(reader, 'the Database pick repository implements the member read');
    const rows = await reader.call(repositories.picks, ['posted', 'settled'], 200);

    for (const row of rows) {
      assert.ok(
        isMemberVisibleOfficialPick({
          status: row.status,
          metadata: row.metadata as Record<string, unknown> | null,
        }),
        `pick ${row.id} (${row.status}) is not member-visible but was returned`,
      );
    }
    for (let index = 1; index < rows.length; index += 1) {
      assert.ok((rows[index - 1]?.created_at ?? '') >= (rows[index]?.created_at ?? ''), 'rows are newest first');
    }

    const runPicks = await restQuery<{ id: string }>(
      `picks?selection=like.*${encodeURIComponent(RUN_NAMESPACE)}*&select=id`,
    );
    assert.ok(
      runPicks.length >= 2,
      `expected this run's Track Only and queued delivery-eligible fixtures, found ${runPicks.length}`,
    );
    const returned = new Set(rows.map((row) => row.id));
    for (const pick of runPicks) {
      assert.ok(!returned.has(pick.id), `this run's fixture pick ${pick.id} must not be member-visible`);
    }

    const postedOnly = await reader.call(repositories.picks, ['posted'], 200);
    assert.ok(postedOnly.every((row) => row.status === 'posted'), 'the status filter is applied');
  },
);

test(
  'WORK-2026092901 live: the dispatch ledger reads through listByEntity with its prefix filter',
  { skip: skipReason },
  async () => {
    const reader = repositories.audit.listByEntity;
    assert.ok(reader, 'the Database audit repository implements the ledger read');
    const ledger = await reader.call(repositories.audit, 'distribution_outbox', randomUUID(), 'distribution.dispatch_');
    assert.deepEqual(ledger, [], 'an entity with no ledger rows reads as an empty ledger, not an error');
    const unprefixed = await reader.call(repositories.audit, 'distribution_outbox', randomUUID());
    assert.deepEqual(unprefixed, []);
  },
);
