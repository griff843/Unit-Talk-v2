import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { experimentRunTypes } from './schema.js';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202604230002_utv2_735_experiment_ledger_shadow_comparison.sql',
    import.meta.url,
  ),
  'utf8',
);

test('experiment_ledger run_type migration allows every schema run type', () => {
  assert.match(
    migration,
    /drop constraint if exists experiment_ledger_run_type_check/i,
  );
  assert.match(migration, /add constraint experiment_ledger_run_type_check/i);

  for (const runType of experimentRunTypes) {
    assert.match(
      migration,
      new RegExp(`'${runType}'`),
      `migration must allow experiment_ledger run_type ${runType}`,
    );
  }
});
