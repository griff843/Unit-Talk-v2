import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { experimentRunTypes } from '../schema.js';

const migration = readFileSync(
  new URL(
    '../../../../supabase/migrations/202604230002_utv2_735_experiment_ledger_shadow_comparison.sql',
    import.meta.url,
  ),
  'utf8',
);

const missingRunTypes = experimentRunTypes.filter(
  (runType) => !migration.includes(`'${runType}'`),
);

assert.equal(
  missingRunTypes.length,
  0,
  `migration is missing experiment_ledger run types: ${missingRunTypes.join(', ')}`,
);

const verdict = {
  schema: 'experiment-ledger-shadow-proof/v1',
  issue: 'UTV2-735',
  migration:
    'supabase/migrations/202604230002_utv2_735_experiment_ledger_shadow_comparison.sql',
  table: 'experiment_ledger',
  constraint: 'experiment_ledger_run_type_check',
  allowedRunTypes: experimentRunTypes,
  assertions: {
    dropsExistingConstraint:
      /drop constraint if exists experiment_ledger_run_type_check/i.test(
        migration,
      ),
    recreatesConstraint:
      /add constraint experiment_ledger_run_type_check/i.test(migration),
    includesEverySchemaRunType: missingRunTypes.length === 0,
  },
  verdict: 'passed',
};

assert.equal(verdict.assertions.dropsExistingConstraint, true);
assert.equal(verdict.assertions.recreatesConstraint, true);

console.log(JSON.stringify(verdict, null, 2));
