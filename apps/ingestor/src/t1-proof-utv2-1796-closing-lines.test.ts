/**
 * T1 live proof: UTV2-1796 — non-vacuous multi-bookmaker closing-line marking.
 *
 * `markClosingLines` read `provider_offer_history_compact`, which holds 3,139 rows
 * for a single event in April while `provider_offer_history` holds 14.4M rows across
 * May and June. Every call selected nothing, marked nothing, and returned a fabricated
 * count equal to the batch size. This proves the repaired behaviour against a real
 * partitioned Postgres, which is the only place partition pruning, PostgREST's exact
 * count, and the generated `identity_key` column exist at all.
 *
 * ## Isolation
 *
 * Writable. The staging identity is asserted before the first write and the test
 * THROWS rather than skips if the target is anything else — a writable proof that
 * silently degrades to a skip on a production credential is not a control.
 *
 * Fixtures are synthetic and namespaced by run; no production row is read or copied,
 * and no provider is called. Cleanup deletes only the namespaced event ids and the
 * absence of residue is asserted, not assumed.
 *
 * Run (staging credentials only):
 *   pnpm ci:assert-staging && pnpm exec tsx --test apps/ingestor/src/t1-proof-utv2-1796-closing-lines.test.ts
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import {
  createServiceRoleDatabaseConnectionConfig,
  createDatabaseClientFromConnection,
  createDatabaseIngestorRepositoryBundle,
  type DatabaseConnectionConfig,
} from '@unit-talk/db';

/**
 * `pnpm ci:assert-staging` is the primary gate and runs before this suite in CI. This
 * is the in-process refusal for the same condition: an app-layer test must not import
 * from the control-plane `scripts/` tree, and a writable proof should not depend on a
 * caller having remembered to run the gate. Both must hold.
 */
const APPROVED_STAGING_PROJECT_REF = 'xskgrzbteyqdufktjrjx';
const CANONICAL_PRODUCTION_PROJECT_REF = 'zfzdnfwdarxucxtaojxm';

export function resolveStagingRefusal(url: string | undefined): string | null {
  if (!url) return 'SUPABASE_URL is not set';
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return `SUPABASE_URL is not a valid URL (${url})`;
  }
  // Only the canonical Supabase host shape resolves a project ref. A custom domain,
  // proxy or tunnel could front production, so it is refused rather than parsed.
  if (!host.endsWith('.supabase.co')) {
    return `host ${host} is not a canonical supabase.co host`;
  }
  const ref = host.slice(0, host.length - '.supabase.co'.length).split('.').pop() ?? '';
  if (ref === CANONICAL_PRODUCTION_PROJECT_REF) {
    return `target is CANONICAL PRODUCTION ${ref}`;
  }
  if (ref !== APPROVED_STAGING_PROJECT_REF) {
    return `target ${ref || 'unknown'} is not the approved staging project`;
  }
  return null;
}

function hasSupabaseEnvironment(): boolean {
  try {
    return Boolean(loadEnvironment().SUPABASE_SERVICE_ROLE_KEY);
  } catch {
    return false;
  }
}

/**
 * True when the environment does not point at a Supabase project at all — the local
 * containment default is `http://127.0.0.1:1` with a placeholder key. That is a
 * "nothing to prove against" condition and skips.
 *
 * It is deliberately NOT the same as pointing at the wrong Supabase project. A real
 * project ref that is not the approved staging one is a misdirected writable proof and
 * fails hard in `before`, because skipping there is exactly how a production write gets
 * past a gate quietly.
 */
function targetsNoSupabaseProject(): boolean {
  try {
    const url = (loadEnvironment() as unknown as Record<string, string | undefined>)[
      'SUPABASE_URL'
    ];
    return !url || !new URL(url).hostname.endsWith('.supabase.co');
  } catch {
    return true;
  }
}

const skipReason = !hasSupabaseEnvironment()
  ? 'SUPABASE_SERVICE_ROLE_KEY not configured — skipping live DB proof'
  : targetsNoSupabaseProject()
    ? 'SUPABASE_URL does not point at a Supabase project (containment) — skipping live DB proof'
    : false;

/** The seven-bookmaker shape observed on a real sgo event, reproduced synthetically. */
const SEVEN_BOOKS = [
  'pinnacle',
  'fanduel',
  'draftkings',
  'betmgm',
  'caesars',
  'bet365',
  'espnbet',
] as const;

const RUN_ID =
  process.env['CI_FIXTURE_RUN_ID'] ?? `local-${randomUUID().slice(0, 8)}`;
const MARKED_EVENT_ID = `utv2-1796-${RUN_ID}-marked`;
const COLLAPSED_EVENT_ID = `utv2-1796-${RUN_ID}-collapsed`;
const FIXTURE_EVENT_IDS = [MARKED_EVENT_ID, COLLAPSED_EVENT_ID];

const PROVIDER_KEY = 'sgo';
const MARKET_KEY = 'utv2-1796-batting_hits+runs+rbi-all-game-ou';
const PARTICIPANT_ID = 'UTV2_1796_SYNTHETIC_PLAYER';

const OFFERS_SNAPSHOT_AT = new Date(Date.now() - 3 * 3_600_000).toISOString();
const COMMENCE_TIME = new Date(Date.now() - 2 * 3_600_000).toISOString();
const CYCLE_SNAPSHOT_AT = new Date().toISOString();

let connection: DatabaseConnectionConfig;

before(async () => {
  if (skipReason) return;
  const env = loadEnvironment() as unknown as Record<string, string | undefined>;

  // Before any write. A failed assertion here is fatal, never a skip.
  const refusal = resolveStagingRefusal(env['SUPABASE_URL']);
  if (refusal) {
    throw new Error(`UTV2-1796 refuses to write: ${refusal}`);
  }
  console.log(
    `[UTV2-1796] staging identity asserted before first write: ${APPROVED_STAGING_PROJECT_REF}`,
  );

  connection = createServiceRoleDatabaseConnectionConfig();

  // The fixture snapshots land in today's and yesterday's partitions; make sure
  // both exist before inserting into a RANGE-partitioned table.
  const client = createDatabaseClientFromConnection(connection);
  for (const iso of [OFFERS_SNAPSHOT_AT, CYCLE_SNAPSHOT_AT]) {
    const day = iso.slice(0, 10);
    const { error } = await (
      client as unknown as {
        rpc: (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ error: { message: string } | null }>;
      }
    ).rpc('ensure_provider_offer_history_partition', { p_day: day });
    assert.equal(error, null, `partition for ${day} must exist: ${error?.message}`);
  }
});

after(async () => {
  if (skipReason || !connection) return;
  const client = createDatabaseClientFromConnection(connection);
  const untyped = client as unknown as {
    from: (table: string) => {
      delete: () => { in: (col: string, vals: string[]) => Promise<{ error: unknown }> };
      select: (
        cols: string,
        opts: Record<string, unknown>,
      ) => { in: (col: string, vals: string[]) => Promise<{ count: number | null }> };
    };
  };

  // Only the uniquely namespaced fixtures. No date sweep, no provider sweep.
  for (const table of ['provider_offer_current', 'provider_offer_history']) {
    await untyped.from(table).delete().in('provider_event_id', FIXTURE_EVENT_IDS);
  }

  for (const table of ['provider_offer_current', 'provider_offer_history']) {
    const { count } = await untyped
      .from(table)
      .select('provider_event_id', { count: 'exact', head: true })
      .in('provider_event_id', FIXTURE_EVENT_IDS);
    assert.equal(count, 0, `${table} must hold no UTV2-1796 fixture residue, found ${count}`);
    console.log(`[UTV2-1796] residue check ${table}: ${count} rows`);
  }
});

function fixtureOffers(providerEventId: string) {
  return SEVEN_BOOKS.map((bookmaker, index) => ({
    providerKey: PROVIDER_KEY,
    providerEventId,
    providerMarketKey: MARKET_KEY,
    providerParticipantId: PARTICIPANT_ID,
    bookmakerKey: bookmaker,
    sportKey: 'MLB',
    line: 1.5,
    overOdds: -110 - index,
    underOdds: -110 + index,
    devigMode: 'PAIRED' as const,
    isOpening: false,
    isClosing: false,
    snapshotAt: OFFERS_SNAPSHOT_AT,
    idempotencyKey: `${providerEventId}:${bookmaker}`,
  }));
}

function countUnmarked(connectionConfig: DatabaseConnectionConfig, eventId: string) {
  const client = createDatabaseClientFromConnection(connectionConfig);
  return (
    client as unknown as {
      from: (table: string) => {
        select: (
          cols: string,
          opts: Record<string, unknown>,
        ) => {
          eq: (
            col: string,
            val: unknown,
          ) => { eq: (col: string, val: unknown) => Promise<{ count: number | null }> };
        };
      };
    }
  )
    .from('provider_offer_history')
    .select('id', { count: 'exact', head: true })
    .eq('provider_event_id', eventId)
    .eq('is_closing', false);
}

test(
  'UTV2-1796: a production-shaped event marks one closing line per bookmaker, with a truthful count',
  { skip: skipReason },
  async () => {
    const repositories = createDatabaseIngestorRepositoryBundle(connection);
    await repositories.providerOffers.upsertBatch(fixtureOffers(MARKED_EVENT_ID));

    const { count: preUnmarked } = await countUnmarked(connection, MARKED_EVENT_ID);
    assert.equal(
      preUnmarked,
      SEVEN_BOOKS.length,
      `pre-count: seven unmarked offers must be seeded, found ${preUnmarked}`,
    );

    const returned = await repositories.providerOffers.markClosingLines(
      [{ providerEventId: MARKED_EVENT_ID, commenceTime: COMMENCE_TIME }],
      CYCLE_SNAPSHOT_AT,
      { includeBookmakerKey: true },
    );
    assert.equal(
      returned,
      SEVEN_BOOKS.length,
      `returned count must be the rows the database actually affected, got ${returned}`,
    );

    const { count: postUnmarked } = await countUnmarked(connection, MARKED_EVENT_ID);
    assert.equal(
      postUnmarked,
      0,
      `post-update delta must equal the returned count; ${postUnmarked} offers left unmarked`,
    );

    // One closing line per bookmaker identity, in history and in the projection.
    const client = createDatabaseClientFromConnection(connection);
    const untyped = client as unknown as {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (
            col: string,
            val: unknown,
          ) => {
            eq: (
              col: string,
              val: unknown,
            ) => Promise<{ data: Array<Record<string, unknown>> | null }>;
          };
        };
      };
    };

    const history = await untyped
      .from('provider_offer_history')
      .select('bookmaker_key')
      .eq('provider_event_id', MARKED_EVENT_ID)
      .eq('is_closing', true);
    assert.deepEqual(
      (history.data ?? []).map((row) => row['bookmaker_key']).sort(),
      [...SEVEN_BOOKS].sort(),
      'every bookmaker on the event must keep exactly one closing line in history',
    );

    const current = await untyped
      .from('provider_offer_current')
      .select('identity_key')
      .eq('provider_event_id', MARKED_EVENT_ID)
      .eq('is_closing', true);
    const identityKeys = (current.data ?? [])
      .map((row) => String(row['identity_key']))
      .sort();
    assert.deepEqual(
      identityKeys,
      [...SEVEN_BOOKS]
        .map(
          (bookmaker) =>
            `${PROVIDER_KEY}:${MARKED_EVENT_ID}:${MARKET_KEY}:${PARTICIPANT_ID}:${bookmaker}`,
        )
        .sort(),
      'the projection must be updated by a reconstructed identity_key that matches the generated column',
    );

    console.log(
      `[UTV2-1796] pre=${preUnmarked} returned=${returned} post=${postUnmarked} identities=${identityKeys.length}`,
    );
  },
);

test(
  'UTV2-1796 inversion: the collapsed de-duplication key loses six of the seven books',
  { skip: skipReason },
  async () => {
    const repositories = createDatabaseIngestorRepositoryBundle(connection);
    await repositories.providerOffers.upsertBatch(fixtureOffers(COLLAPSED_EVENT_ID));

    const { count: preUnmarked } = await countUnmarked(connection, COLLAPSED_EVENT_ID);
    assert.equal(preUnmarked, SEVEN_BOOKS.length, 'inversion fixture must seed seven offers');

    // The defect being guarded against: omit includeBookmakerKey and the seven books
    // share one de-duplication key, so only the latest single offer is marked.
    const returned = await repositories.providerOffers.markClosingLines(
      [{ providerEventId: COLLAPSED_EVENT_ID, commenceTime: COMMENCE_TIME }],
      CYCLE_SNAPSHOT_AT,
    );
    assert.equal(
      returned,
      1,
      `without the bookmaker in the key the books collapse to one closing line, got ${returned}`,
    );

    const { count: postUnmarked } = await countUnmarked(connection, COLLAPSED_EVENT_ID);
    assert.equal(
      postUnmarked,
      SEVEN_BOOKS.length - 1,
      `six books must be left without a closing line under the collapsed key, found ${postUnmarked}`,
    );

    console.log(
      `[UTV2-1796] inversion: returned=${returned} still_unmarked=${postUnmarked}`,
    );
  },
);

// The refusal above is the control that keeps this writable suite off production. It
// runs offline so it is proven on every `pnpm test`, not only when credentials exist.
test('UTV2-1796: the staging refusal admits only the approved staging project', () => {
  assert.equal(
    resolveStagingRefusal(`https://${APPROVED_STAGING_PROJECT_REF}.supabase.co`),
    null,
  );
  assert.match(
    String(resolveStagingRefusal(`https://${CANONICAL_PRODUCTION_PROJECT_REF}.supabase.co`)),
    /CANONICAL PRODUCTION/,
  );
  assert.match(String(resolveStagingRefusal(undefined)), /not set/);
  assert.match(String(resolveStagingRefusal('not-a-url')), /not a valid URL/);
  // A custom domain could front production; it is refused, not parsed.
  assert.match(String(resolveStagingRefusal('https://db.unittalk.com')), /not a canonical/);
  assert.match(
    String(resolveStagingRefusal('https://someoneelse.supabase.co')),
    /not the approved staging project/,
  );
});
