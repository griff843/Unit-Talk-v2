/**
 * T1 Pre-Merge Proof: WORK-2026092901 member pick truth and the dispatch ledger read
 *
 * Exercises the two new Database repository reads against real Postgres:
 *
 *   - DatabasePickRepository.listMemberVisibleOfficialPicks: the JSON-path
 *     filters (`metadata->>distributionMode`, `metadata->deliveryAuthorization->>decision`)
 *     are only checked by PostgREST at run time, so an in-memory test cannot
 *     prove them. Every returned row must satisfy the contract predicate.
 *   - DatabaseAuditLogRepository.listByEntity: the worker and the retry route
 *     read the dispatch ledger through it; a broken column name or prefix
 *     filter would make every official-picks claim dead-letter.
 *
 * READ-ONLY. This proof writes nothing, so it is safe against any database.
 *
 * Run:
 *   UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-work-2026092901-member-picks-and-ledger.test.ts
 */

import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import {
  DatabaseAuditLogRepository,
  DatabasePickRepository,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';
import { isMemberVisibleOfficialPick } from '@unit-talk/contracts';

function hasSupabaseSmokeEnvironment() {
  try {
    const env = loadEnvironment();
    return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  } catch {
    return false;
  }
}

const skipReason = hasSupabaseSmokeEnvironment()
  ? false
  : 'SUPABASE_SERVICE_ROLE_KEY not configured — skipping live DB proof';

let picks: DatabasePickRepository;
let audit: DatabaseAuditLogRepository;

before(() => {
  if (skipReason) return;
  const connection = createServiceRoleDatabaseConnectionConfig(loadEnvironment());
  picks = new DatabasePickRepository(connection);
  audit = new DatabaseAuditLogRepository(connection);
});

test('WORK-2026092901 listMemberVisibleOfficialPicks returns only member-visible official picks', { skip: skipReason }, async () => {
  assert.ok(picks.listMemberVisibleOfficialPicks, 'the Database repository implements the member read');
  const rows = await picks.listMemberVisibleOfficialPicks(['posted', 'settled'], 200);

  for (const row of rows) {
    assert.ok(
      isMemberVisibleOfficialPick({ status: row.status, metadata: row.metadata as Record<string, unknown> | null }),
      `pick ${row.id} (${row.status}) is not member-visible but was returned`,
    );
  }
  for (let index = 1; index < rows.length; index += 1) {
    assert.ok(
      (rows[index - 1]?.created_at ?? '') >= (rows[index]?.created_at ?? ''),
      'rows are newest first',
    );
  }

  const postedOnly = await picks.listMemberVisibleOfficialPicks(['posted'], 200);
  assert.ok(postedOnly.every((row) => row.status === 'posted'), 'the status filter is applied');
  console.log(`  member-visible official picks: ${rows.length} (posted: ${postedOnly.length})`);
});

test('WORK-2026092901 listByEntity reads the dispatch ledger with its prefix filter', { skip: skipReason }, async () => {
  assert.ok(audit.listByEntity, 'the Database repository implements the ledger read');
  const unknown = await audit.listByEntity('distribution_outbox', randomUUID(), 'distribution.dispatch_');
  assert.deepEqual(unknown, [], 'an entity with no ledger rows reads as an empty ledger, not an error');

  const unprefixed = await audit.listByEntity('distribution_outbox', randomUUID());
  assert.deepEqual(unprefixed, []);
});
