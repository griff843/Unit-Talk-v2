// Probe: runs under `--experimental-test-isolation=none`, where NODE_TEST_CONTEXT
// is NOT set and `--test` appears only in execArgv. Asserts the client boundary
// still refuses a production service-role client.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabaseConnectionConfig } from '../../../packages/db/src/client.ts';

test('boundary holds when execArgv is the only test signal', () => {
  assert.equal(process.env.NODE_TEST_CONTEXT, undefined, 'probe precondition');
  assert.ok(process.execArgv.some((a) => a === '--test' || a.startsWith('--test-')));
  delete process.env.UNIT_TALK_DB_ACCESS_MODE;
  assert.throws(
    () =>
      createDatabaseConnectionConfig({
        env: {
          SUPABASE_URL: 'https://zfzdnfwdarxucxtaojxm.supabase.co',
          SUPABASE_ANON_KEY: 'a',
          SUPABASE_SERVICE_ROLE_KEY: 's',
        },
        useServiceRole: true,
      }),
    /Refusing to construct a service-role client/,
  );
});
