# PROOF: UTV2-1981 — executor verification (attempt 2)

MERGE_SHA: pending merge

Verified source SHA: 07107d11d0d241c5933d1e671878e6e5eb09dfca (earlier attempt: 1741d71b9ce5b640a179f83412cccdc20d1d0e5d). Draft PR: https://github.com/griff843/Unit-Talk-v2/pull/1834.
No READY_FOR_REVIEW attestation, PM approval, merge, live DDL or lane finalization.

## ASSERTIONS:

- The migration refuses a same-named index that is not a valid, ready, non-unique btree on `public.picks(updated_at)` (SQLSTATE `42P07`), and otherwise creates it with `IF NOT EXISTS`; the repo file carries no `CONCURRENTLY`.
- The down script is exactly `DROP INDEX IF EXISTS public.picks_updated_at_idx;` and survives an up, down, up round trip.
- Staging writable-DB proof, and parity against production, are NOT yet passing; both are recorded as such below and nothing here claims them.

## EVIDENCE:

The sections that follow hold the evidence: focused and root test results, exact-head CI receipts, the scratch PostgreSQL transcript, and the staging failure.

## Verification

The focused suite passed 135/135; `pnpm type-check` passed. Local `pnpm test:db`
refused before writes: host=127.0.0.1, ref=unidentified, expected=xskgrzbteyqdufktjrjx.
Writable verification requires `staging-ci` and `CI_SUPABASE_*` credentials.
Packet originally reported host=unparseable. No guard bypass or credential copying.
Index-only DDL has no generated TypeScript schema surface; regeneration is deferred
with live project access, and `database.types.ts` is unchanged.

`pnpm verify:static` PASS (exit 0 as the static child of `pnpm verify`): lint,
type-check, build, root tests, production verifier tests, Smart Form verification
and migration lint all completed. Root `pnpm test` PASS: 7,881 tests, 7,868 passed,
13 skipped, 0 failed. The following 14 production-verifier tests and 227 Smart
Form tests also passed. Standard static verification did not enable browser e2e.
Full `pnpm verify` BLOCKED (exit 1) after static PASS at the writable staging
identity assertion. Exact final output:

```text
  type: 'test'
  ...
1..153
# tests 227
# suites 23
# pass 227
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2918.003116
smart-form e2e: not run (UNIT_TALK_SMART_FORM_E2E is not set).
Set UNIT_TALK_SMART_FORM_E2E=1 to run it. It requires a Playwright browser:
  pnpm exec playwright install chromium --with-deps
[command-manifest] Verified 14 command definition(s) against /home/griff843/code/Unit-Talk-v2/.out/worktrees/control__utv2-1981/.out/worktrees/codex__utv2-1981-picks-updated-at-index/apps/discord-bot/command-manifest.json
[check-migration-versions] 140 migration file(s) verified — no duplicate versions.
[lint-migrations] Skipping schema baseline replay-root 00000000000000_baseline_live_schema.sql (snapshot, not a forward migration; fidelity verified by Live Schema Parity).
[lint-migrations] 139 migration file(s) checked — no findings.
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```

Local logs and SHA-256 digests are recorded in evidence.json.
Post-commit R-level check against origin/main passed: 11 changed files, no matching
rules or additional R-level artifacts. Migration reversibility presence check
passed: checked 1, passed 1, failed 0. The supplied pre-push acceptance block passed.

## Exact implementation-SHA CI receipts

| Receipt                | Result                              | Run                                                    | Job                                                          |
| ---------------------- | ----------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| Precondition drill     | PASS                                | [42349510510](https://github.com/griff843/Unit-Talk-v2/actions/runs/42349510510)                          | [128334428692](https://github.com/griff843/Unit-Talk-v2/actions/runs/42349510510/job/128334428692)              |
| Schema round trip      | PASS                                | 42349510510                                            | [128334428644](https://github.com/griff843/Unit-Talk-v2/actions/runs/42349510510/job/128334428644)              |
| Staging writable proof | PASS                                | [42349510567](https://github.com/griff843/Unit-Talk-v2/actions/runs/42349510567)                          | [128334429172](https://github.com/griff843/Unit-Talk-v2/actions/runs/42349510567/job/128334429172)              |
| Live Schema Parity     | PENDING_POST_DEPLOY (observed FAIL) | [42349510570](https://github.com/griff843/Unit-Talk-v2/actions/runs/42349510570)                          | [128334449741](https://github.com/griff843/Unit-Talk-v2/actions/runs/42349510570/job/128334449741)              |

Receipts above are at the exact verified source SHA
`07107d11d0d241c5933d1e671878e6e5eb09dfca` (the earlier attempt at
`1741d71b9ce5b640a179f83412cccdc20d1d0e5d` had a writable-proof FAIL, run 42345350967 job
128321774196, a statement timeout in `listByLifecycleStates`; it is superseded by the
passing run above but shows the timeout is intermittent).

The CI precondition drill refused a same-named table with 42P07, preserved its
fingerprint, restored the scratch schema and applied with no index present.
Round-trip hashes: pre-up/post-down
`1f5dd57add8cb9758b8aa13d13ce408a0ceacd87b70d5c01fb449c2a10067b44`;
post-up/post-reup `a00dab7d08e881476261acb2140bccea03ebe80c68ca2981a8391d104fb76386`.

Parity log: `indexes missing_in_actual public.picks.picks_updated_at_idx`.
`production_ddl_applied: false`; `required_phase: post-deploy-before-lane-close`.
Parity must PASS after separately authorized production deployment and before lane close.
The initial down-presence job 128321773693 failed at its embedded proof-binding
validator because it read the prior attempt's stale source SHA and pending
receipts; the down-presence CLI passed locally. No drill or gate was modified.

## Verification boundary

| Proven                                                                                  | Not proven / deferred                                                            |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Guard refusals and matching-index no-op in isolated scratch PostgreSQL                  | Staging migration effect and validity/size                                       |
| CI empty-target refusal drill and full baseline schema round trip                       | Staging before/after plans and under-load timings                                |
| Static verify and root/focused tests, type-check; post-commit R-level and down presence | Insert/update overhead, HOT ratio, build duration and scaled production estimate |
| No generated type/application/test/gate changes                                         | Production DDL, ledger apply and post-deploy parity PASS                         |

Existing staging-only indexes (`picks_staging_*`, `picks_open_states_created_idx`,
`picks_track_only_validated_created_idx`) remain outside scope. No claim that
staging slow phases or timeouts are resolved. Production apply and concurrent
rollback are design only in `production-apply-packet.md`.

## Additional scratch PostgreSQL transcript

Local PostgreSQL 17.6 was built under `/tmp/utv2-1981-pg`; no package or test files
were added to the repo. An isolated cluster used loopback port 55481, trust auth
and no live project credentials. The minimal picks table isolates index guard
semantics; the CI round-trip receipt above covers the full migration baseline.
Catalog validity flags were forced false only inside this disposable cluster.
The following exact commands ran successfully (cluster stopped after the drill):

```bash
/tmp/utv2-1981-pg/bin/initdb -D /tmp/utv2-1981-pgdata -A trust --no-locale
/tmp/utv2-1981-pg/bin/pg_ctl -D /tmp/utv2-1981-pgdata -l /tmp/utv2-1981-a2-postgres.log -o '-h 127.0.0.1 -p 55481 -k /tmp' start
python3 /tmp/utv2-1981-scratch.py
/tmp/utv2-1981-pg/bin/pg_ctl -D /tmp/utv2-1981-pgdata stop
```

Exact scratch script (each migration attempt uses psql ON_ERROR_STOP and verbose SQLSTATEs):

```python
import subprocess, hashlib, re
from pathlib import Path
bin = '/tmp/utv2-1981-pg/bin/'
dsn = 'postgresql://griff843@127.0.0.1:55481/postgres'
up = 'supabase/migrations/20261107060000_utv2_1981_picks_updated_at_idx.sql'
down = 'db/migrations-rollback/20261107060000_utv2_1981_picks_updated_at_idx.down.sql'
def sql(s):
    p = subprocess.run([bin+'psql', dsn, '-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-c', s], capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    print(s)
def apply():
    return subprocess.run([bin+'psql', dsn, '-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-f', up], capture_output=True, text=True)
def fingerprint():
    dump = subprocess.check_output([bin+'pg_dump', dsn, '--schema-only', '--schema=public', '--no-owner', '--no-acl', '--no-comments', '--no-publications', '--no-subscriptions'], text=True)
    dump = re.sub(r'^--.*\n', '', dump, flags=re.M)
    dump = re.sub(r'^\\(?:un)?restrict\b.*\n', '', dump, flags=re.M).strip()
    return hashlib.sha256(dump.encode()).hexdigest()
print('PostgreSQL scratch only; 127.0.0.1:55481; no project credentials')
sql('CREATE TABLE public.picks (updated_at timestamptz, created_at timestamptz);')
for label, setup in [
 ('INVALID', "CREATE INDEX picks_updated_at_idx ON public.picks (updated_at); UPDATE pg_catalog.pg_index SET indisvalid=false WHERE indexrelid='public.picks_updated_at_idx'::regclass;"),
 ('wrong column', 'CREATE INDEX picks_updated_at_idx ON public.picks (created_at);'),
 ('partial', 'CREATE INDEX picks_updated_at_idx ON public.picks (updated_at) WHERE updated_at IS NOT NULL;'),
 ('not ready', "CREATE INDEX picks_updated_at_idx ON public.picks (updated_at); UPDATE pg_catalog.pg_index SET indisready=false WHERE indexrelid='public.picks_updated_at_idx'::regclass;"),
 ('unique', 'CREATE UNIQUE INDEX picks_updated_at_idx ON public.picks (updated_at);'),
 ('expression', "CREATE INDEX picks_updated_at_idx ON public.picks ((updated_at AT TIME ZONE 'UTC'));"),
 ('included column', 'CREATE INDEX picks_updated_at_idx ON public.picks (updated_at) INCLUDE (created_at);'),
]:
    sql(setup)
    before = fingerprint()
    p = apply()
    assert p.returncode != 0 and '42P07' in p.stderr, (label, p.stdout, p.stderr)
    assert before == fingerprint(), label+' changed schema'
    print(label+': REFUSED SQLSTATE 42P07; schema fingerprint unchanged: '+before)
    print(next(l for l in p.stderr.splitlines() if 'ERROR:' in l))
    sql('DROP INDEX public.picks_updated_at_idx;')
sql('CREATE TABLE public.other_picks (updated_at timestamptz); CREATE INDEX picks_updated_at_idx ON public.other_picks (updated_at);')
p=apply()
assert p.returncode != 0 and '42P07' in p.stderr, p.stderr
print('wrong table: REFUSED SQLSTATE 42P07')
sql('DROP TABLE public.other_picks;')
base=fingerprint()
p=apply()
assert p.returncode == 0, p.stderr
indexed=fingerprint()
print('absent index: PASS SQLSTATE 00000; '+indexed)
p=apply()
assert p.returncode == 0 and indexed == fingerprint(), p.stderr
print('valid matching index: PASS SQLSTATE 00000; schema fingerprint unchanged: '+indexed)
subprocess.run([bin+'psql', dsn, '-X', '-v', 'ON_ERROR_STOP=1', '-f', down], check=True)
assert base == fingerprint()
p=apply()
assert p.returncode == 0 and indexed == fingerprint()
print('up/down/up: PASS; base='+base+'; indexed='+indexed)
```

Measured output:

```text
DROP INDEX
PostgreSQL scratch only; 127.0.0.1:55481; no project credentials
CREATE TABLE public.picks (updated_at timestamptz, created_at timestamptz);
CREATE INDEX picks_updated_at_idx ON public.picks (updated_at); UPDATE pg_catalog.pg_index SET indisvalid=false WHERE indexrelid='public.picks_updated_at_idx'::regclass;
INVALID: REFUSED SQLSTATE 42P07; schema fingerprint unchanged: fc082093193131f06df8ba480766f1dc1d8dafa64cb1004870ffd8be581fc0f3
psql:supabase/migrations/20261107060000_utv2_1981_picks_updated_at_idx.sql:29: ERROR:  42P07: public.picks_updated_at_idx exists but is not a valid ready nonunique btree on public.picks(updated_at)
DROP INDEX public.picks_updated_at_idx;
CREATE INDEX picks_updated_at_idx ON public.picks (created_at);
wrong column: REFUSED SQLSTATE 42P07; schema fingerprint unchanged: 89054d89c2278dbdd526d236c4e32d69f5eb8e8fd55ee1b0294782bd13f8ff6e
psql:supabase/migrations/20261107060000_utv2_1981_picks_updated_at_idx.sql:29: ERROR:  42P07: public.picks_updated_at_idx exists but is not a valid ready nonunique btree on public.picks(updated_at)
DROP INDEX public.picks_updated_at_idx;
CREATE INDEX picks_updated_at_idx ON public.picks (updated_at) WHERE updated_at IS NOT NULL;
partial: REFUSED SQLSTATE 42P07; schema fingerprint unchanged: 978bfc22869a94054cd24ec0bea3357b3c4ef2ac0e9e0f90ee0f8ebd35a65ca6
psql:supabase/migrations/20261107060000_utv2_1981_picks_updated_at_idx.sql:29: ERROR:  42P07: public.picks_updated_at_idx exists but is not a valid ready nonunique btree on public.picks(updated_at)
DROP INDEX public.picks_updated_at_idx;
CREATE INDEX picks_updated_at_idx ON public.picks (updated_at); UPDATE pg_catalog.pg_index SET indisready=false WHERE indexrelid='public.picks_updated_at_idx'::regclass;
not ready: REFUSED SQLSTATE 42P07; schema fingerprint unchanged: fc082093193131f06df8ba480766f1dc1d8dafa64cb1004870ffd8be581fc0f3
psql:supabase/migrations/20261107060000_utv2_1981_picks_updated_at_idx.sql:29: ERROR:  42P07: public.picks_updated_at_idx exists but is not a valid ready nonunique btree on public.picks(updated_at)
DROP INDEX public.picks_updated_at_idx;
CREATE UNIQUE INDEX picks_updated_at_idx ON public.picks (updated_at);
unique: REFUSED SQLSTATE 42P07; schema fingerprint unchanged: f4c713e5a78719d13c9a33b9a8fcf6559c4e105925f230daec6d3236241d052a
psql:supabase/migrations/20261107060000_utv2_1981_picks_updated_at_idx.sql:29: ERROR:  42P07: public.picks_updated_at_idx exists but is not a valid ready nonunique btree on public.picks(updated_at)
DROP INDEX public.picks_updated_at_idx;
CREATE INDEX picks_updated_at_idx ON public.picks ((updated_at AT TIME ZONE 'UTC'));
expression: REFUSED SQLSTATE 42P07; schema fingerprint unchanged: 30de99f6a0e05b78da99082b23f359de617fcab3e044fdba9f8c79b09644b94f
psql:supabase/migrations/20261107060000_utv2_1981_picks_updated_at_idx.sql:29: ERROR:  42P07: public.picks_updated_at_idx exists but is not a valid ready nonunique btree on public.picks(updated_at)
DROP INDEX public.picks_updated_at_idx;
CREATE INDEX picks_updated_at_idx ON public.picks (updated_at) INCLUDE (created_at);
included column: REFUSED SQLSTATE 42P07; schema fingerprint unchanged: f630bb56366d29c11044f904ca6a6d2979eb53de19ba99828304b0bfda5d8bf9
psql:supabase/migrations/20261107060000_utv2_1981_picks_updated_at_idx.sql:29: ERROR:  42P07: public.picks_updated_at_idx exists but is not a valid ready nonunique btree on public.picks(updated_at)
DROP INDEX public.picks_updated_at_idx;
CREATE TABLE public.other_picks (updated_at timestamptz); CREATE INDEX picks_updated_at_idx ON public.other_picks (updated_at);
wrong table: REFUSED SQLSTATE 42P07
DROP TABLE public.other_picks;
absent index: PASS SQLSTATE 00000; d9e9e80dfae080f4a63bb827e100f4db61e314f7136ccf24fe385f08feacb24d
valid matching index: PASS SQLSTATE 00000; schema fingerprint unchanged: d9e9e80dfae080f4a63bb827e100f4db61e314f7136ccf24fe385f08feacb24d
up/down/up: PASS; base=fc082093193131f06df8ba480766f1dc1d8dafa64cb1004870ffd8be581fc0f3; indexed=d9e9e80dfae080f4a63bb827e100f4db61e314f7136ccf24fe385f08feacb24d
```

## Staging failure and executor boundary

Exact-head `staging-ci` writable job 128321774196 in run 42345350967 completed FAIL.
At 2026-11-07T06:12:16Z, `WORK0307 staging: complete readers and duplicate timestamp
boundary mutations` failed after 11,126.6 ms:

```text
Failed to listByLifecycleStates: canceling statement due to statement timeout
DatabasePickRepository.listByLifecycleStates (packages/db/src/runtime-repositories.ts:3564:33)
apps/api/src/t1-proof-work-2026110307-keyset-paging-live.test.ts:44:9
```

Earlier suites in that job passing does not establish overall writable proof.
The index has not been applied by this executor; staging index/performance proof
remains deferred. No application, retry, timeout, fixture or gate changes were made
to respond to this failure. Draft candidate is BLOCKED, with no successful full
verify or migration-proof completion claimed. The versioned proof-binding validator
remains FAIL because it requires a passing writable staging receipt.

## Later proof-only head and a repeat staging timeout

PR head `4ba93c9139cb20694bcf9da9309dbcf388708e29` differs from `07107d11d` only in
`docs/06_status/proof/**`. Its CI run 42351038313 job 128339020022 (staging writable proof)
FAILED with `Failed to listByLifecycleStates:` in `WORK0307 staging: complete readers and
duplicate timestamp boundary mutations`, so the `verify` context failed closed. No
application code changed between the passing and failing runs. This is a second observed
instance of the intermittent staging timeout the index targets; it is not evidence that
the index works or fails. Parity at this head is still `PENDING_POST_DEPLOY`
(`missing_in_actual public.picks.picks_updated_at_idx`).

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1834
Verified source SHA: 07107d11d0d241c5933d1e671878e6e5eb09dfca
