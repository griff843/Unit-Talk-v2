/**
 * Writable staging proof for WORK-2026101203.
 *
 * Run on demand only in the governed staging-ci environment:
 *   pnpm exec tsx packages/db/src/scripts/work-2026101203-wnba-reference-catalog-proof.ts
 *
 * Requires SUPABASE_URL to identify the approved staging project and
 * SUPABASE_DB_URL for psql. The target guard runs before a DB client is opened.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { loadEnvironment } from '@unit-talk/config';

// Reuse the repository's executable target-identity control. This must finish
// before the proof reads a DB connection string or starts psql.
execFileSync('pnpm', ['ci:assert-staging'], { stdio: 'inherit' });
const env = loadEnvironment() as unknown as Record<string, string | undefined>;
const approvedStagingRef = 'xskgrzbteyqdufktjrjx';

const databaseUrl = env['SUPABASE_DB_URL'];
assert.ok(
  databaseUrl,
  'SUPABASE_DB_URL is required to apply and verify the migration on governed staging',
);
assert.ok(
  databaseUrl.includes(approvedStagingRef),
  'SUPABASE_DB_URL does not identify the same approved staging project as SUPABASE_URL',
);
const verifiedDatabaseUrl = databaseUrl;

const migrationPath = new URL(
  '../../../../supabase/migrations/20261012180000_wnba_reference_catalog.sql',
  import.meta.url,
);
const migration = readFileSync(migrationPath, 'utf8');

function psql(sql: string): string {
  return execFileSync(
    'psql',
    [
      verifiedDatabaseUrl,
      '-X',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
      '-v',
      'VERBOSITY=verbose',
    ],
    { encoding: 'utf8', input: sql, timeout: 30_000 },
  ).trim();
}

function expectRefusal(setupSql: string, expected: RegExp): void {
  const transactionBody = migration
    .replace(/^\s*BEGIN;\s*/u, '')
    .replace(/\s*COMMIT;\s*$/u, '');
  try {
    psql(`BEGIN;\n${setupSql}\n${transactionBody}`);
    assert.fail(`expected refusal matching ${expected}`);
  } catch (error) {
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error
        ? String((error as { stderr?: unknown }).stderr ?? '')
        : String(error);
    assert.match(stderr, expected);
  }
}

// Apply the exact migration. A prior staging run is safe: the migration is
// idempotent and the following assertions read the resulting persisted rows.
psql(migration);

const result = JSON.parse(
  psql(`
  SELECT jsonb_build_object(
    'sport', (SELECT count(*) FROM public.sports WHERE id = 'WNBA' AND display_name = 'WNBA' AND active),
    'league', (SELECT count(*) FROM public.leagues WHERE id = 'wnba' AND sport_id = 'WNBA' AND active),
    'availability', (SELECT count(*) FROM public.sport_market_type_availability WHERE sport_id = 'WNBA' AND active),
    'participants', (SELECT count(*) FROM public.participants WHERE sport = 'WNBA' AND participant_type = 'team'),
    'seededParticipants', (SELECT count(*) FROM public.participants WHERE sport = 'WNBA' AND metadata->>'seedIssue' = 'WORK-2026101203')
  );
`),
) as Record<string, number>;

assert.deepEqual(result, {
  sport: 1,
  league: 1,
  availability: 22,
  participants: 15,
  seededParticipants: 15,
});

const atlantaId = '75907305-08cc-5d4d-8bc5-8f5555e82264';
expectRefusal(
  `UPDATE public.participants SET sport = 'NBA' WHERE id = '${atlantaId}';`,
  /canonical external identity conflict/u,
);
expectRefusal(
  `UPDATE public.participants SET external_id = 'unit-talk:wnba:uuid-conflict' WHERE id = '${atlantaId}';`,
  /governed UUID conflict/u,
);
expectRefusal(
  `INSERT INTO public.participants (id, external_id, participant_type, sport, league, display_name, metadata)
   VALUES (gen_random_uuid(), 'unit-talk:wnba:ambiguous-proof', 'team', 'WNBA', 'wnba', 'Atlanta Dream', '{"proofIssue":"WORK-2026101203"}');`,
  /ambiguous canonical participant identity/u,
);

assert.equal(
  psql(
    `SELECT count(*) FROM public.participants WHERE sport = 'WNBA' AND participant_type = 'team';`,
  ),
  '15',
  'refusal probes must roll back without changing the governed catalog',
);

console.log(
  JSON.stringify(
    {
      issue: 'WORK-2026101203',
      target: approvedStagingRef,
      migration: '20261012180000_wnba_reference_catalog.sql',
      assertions: result,
      refusalSemantics: ['external-id', 'governed-uuid', 'ambiguous-name'],
      verdict: 'pass',
    },
    null,
    2,
  ),
);
