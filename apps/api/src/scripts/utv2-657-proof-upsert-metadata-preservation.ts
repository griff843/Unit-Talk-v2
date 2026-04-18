/**
 * UTV2-657 — MLB Bulk Roster Cache + Upsert Metadata Preservation Proof
 *
 * Live-DB proof for two fixes:
 *   1. MLB bulk roster cache: MLB headshot coverage should be >= 90% (was 63.9%).
 *   2. Upsert metadata preservation: re-upserting a participant with headshot_url: null
 *      must not overwrite an existing enriched headshot_url value.
 *
 * Run: npx tsx apps/api/src/scripts/utv2-657-proof-upsert-metadata-preservation.ts
 *
 * Exit 0 = all assertions PASS
 * Exit 1 = one or more assertions FAIL
 */

import { loadEnvironment } from '@unit-talk/config';
import { DatabaseParticipantRepository, createServiceRoleDatabaseConnectionConfig } from '@unit-talk/db';

const env = loadEnvironment();
const SUPABASE_URL = env.SUPABASE_URL!;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

const BASE_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'count=exact',
};

async function supabaseGet(path: string): Promise<{ data: unknown; count: number | null }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: BASE_HEADERS });
  const rangeHeader = res.headers.get('content-range');
  const count = rangeHeader ? parseInt(rangeHeader.split('/')[1]!, 10) : null;
  const data = await res.json();
  return { data, count };
}

async function supabaseCount(path: string): Promise<number> {
  // HEAD request returns only headers — no body, just the count
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'HEAD',
    headers: BASE_HEADERS,
  });
  const rangeHeader = res.headers.get('content-range');
  return rangeHeader ? parseInt(rangeHeader.split('/')[1]!, 10) : 0;
}

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail: string) {
  if (condition) {
    console.log(`  PASS  ${label}: ${detail}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}: ${detail}`);
    failed++;
  }
}

async function main() {
  console.log('\n=== UTV2-657 Live-DB Proof ===\n');

  // ── 1. MLB coverage >= 90% ───────────────────────────────────────────────
  console.log('1. MLB headshot coverage (bulk roster cache fix)');
  const mlbTotal = await supabaseCount('participants?participant_type=eq.player&sport=eq.MLB');
  const mlbHas = await supabaseCount(
    'participants?participant_type=eq.player&sport=eq.MLB&metadata->>headshot_url=not.is.null&metadata->>headshot_url=neq.null',
  );
  const mlbPct = mlbTotal > 0 ? (mlbHas / mlbTotal) * 100 : 0;
  assert('MLB coverage', mlbPct >= 90, `${mlbHas}/${mlbTotal} = ${mlbPct.toFixed(1)}% (threshold: 90%)`);

  // ── 2. NHL headshots not wiped by ingestor ───────────────────────────────
  console.log('\n2. NHL headshot coverage (upsert preservation fix)');
  const nhlTotal = await supabaseCount('participants?participant_type=eq.player&sport=eq.NHL');
  const nhlHas = await supabaseCount(
    'participants?participant_type=eq.player&sport=eq.NHL&metadata->>headshot_url=not.is.null&metadata->>headshot_url=neq.null',
  );
  const nhlPct = nhlTotal > 0 ? (nhlHas / nhlTotal) * 100 : 0;
  assert('NHL coverage', nhlPct >= 90, `${nhlHas}/${nhlTotal} = ${nhlPct.toFixed(1)}% (threshold: 90%)`);

  // ── 3. Upsert preservation: round-trip test via DatabaseParticipantRepository ─
  console.log('\n3. upsertByExternalId preserves headshot_url when incoming is null');
  const connection = createServiceRoleDatabaseConnectionConfig();
  const repo = new DatabaseParticipantRepository(connection);

  // Find a real enriched NHL player to test with
  const { data: testPlayerArr } = await supabaseGet(
    `participants?participant_type=eq.player&sport=eq.NHL&metadata->>headshot_url=not.is.null&metadata->>headshot_url=neq.null&select=id,display_name,external_id,metadata&order=display_name&limit=1`,
  );
  const testPlayers = Array.isArray(testPlayerArr) ? testPlayerArr : [];
  const testPlayer = testPlayers[0] as { id: string; display_name: string; external_id: string; metadata: Record<string, unknown> } | undefined;

  if (!testPlayer) {
    console.error('  SKIP  No enriched NHL player found to test with');
    failed++;
  } else {
    const originalHeadshot = testPlayer.metadata?.headshot_url as string;

    // Re-upsert with headshot_url: null (simulating an ingestor run)
    await repo.upsertByExternalId({
      externalId: testPlayer.external_id,
      displayName: testPlayer.display_name,
      participantType: 'player',
      sport: 'NHL',
      league: 'nhl',
      metadata: {
        headshot_url: null,
        position: null,
        jersey_number: null,
        team_external_id: null,
      },
    });

    // Verify headshot_url was preserved
    const after = await repo.findByExternalId(testPlayer.external_id);
    const afterHeadshot = (after?.metadata as Record<string, unknown>)?.headshot_url;

    assert(
      'headshot preserved after upsert with null',
      afterHeadshot === originalHeadshot,
      `${testPlayer.display_name}: "${afterHeadshot}" === "${originalHeadshot}"`,
    );
  }

  // ── 4. Known stars have headshots ────────────────────────────────────────
  console.log('\n4. Known star players have headshots');
  const stars = ['Connor McDavid', 'Aaron Judge', 'Anthony Edwards', 'A.J. Brown'];
  for (const name of stars) {
    const { data: rows } = await supabaseGet(
      `participants?participant_type=eq.player&display_name=eq.${encodeURIComponent(name)}&select=display_name,metadata`,
    );
    const row = Array.isArray(rows) ? (rows[0] as { display_name: string; metadata: Record<string, unknown> } | undefined) : undefined;
    const headshot = row?.metadata?.headshot_url;
    assert(`${name} has headshot`, typeof headshot === 'string' && headshot.length > 0, headshot ? String(headshot).slice(0, 60) + '…' : 'null/missing');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Passed: ${passed}  Failed: ${failed}`);
  if (failed > 0) {
    console.error('\nPROOF FAILED');
    process.exit(1);
  }
  console.log('\nPROOF PASSED');
  process.exit(0);
}

main().catch((err) => {
  console.error('Proof script error:', err);
  process.exit(1);
});
