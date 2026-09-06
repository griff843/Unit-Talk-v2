# PROOF: UTV2-1841

MERGE_SHA: pending merge
Execution SHA: c7b170b1ecd10548e6bfcad38f895a3f1b3ffa5e

Align the `Deploy` workflow's verification runtime with the Node version the repository declares
and production actually runs, unblocking the Smart Form deployment candidate.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1520

`sha_binding.merge_sha` is `null` pre-merge. `verified_source_sha` is
`c7b170b1ecd10548e6bfcad38f895a3f1b3ffa5e`, the last non-proof commit on the branch; everything
after it touches only `docs/06_status/proof/UTV2-1841/` and `docs/06_status/lanes/UTV2-1841.json`,
which are inside `PROOF_ONLY_PREFIXES` and do not move the anchor. The binding is written after
merge by `ops:proof-generate --merge-sha`; no manual append is made here.

## Summary

`Deploy` run **34031708984**, candidate `391d4345c499f75255a749f73ce26cae7d44cce7`, failed its
`verify` job. 479 of 480 tests in the command-center suite passed; the single failure was
`apps/command-center/src/lib/data/client-cache-auth.test.ts:55`,
`cached service-role client reauthenticates every request`, reported as `not ok 65`.

The failure is a **runtime artifact, not a defect in the code under test and not a fail-open.**
`deploy.yml` pinned `node-version: 20` for the job that runs the repository's own verify suite.
Everything that job exists to gate says 22:

| Declaration | Value |
|---|---|
| `package.json` `engines.node` | `>=22.0.0` |
| `.nvmrc` | `22` |
| `Dockerfile` — api, worker, ingestor, discord-bot, builder | `node:22-alpine` |
| `apps/command-center/Dockerfile` | `node:22-alpine` |
| `deploy/production/Dockerfile.nextjs` | `ARG NODE_VERSION=22-alpine` |

Four workflows run the verify suite — `ci.yml`, `proof-gate.yml`, `t1-proof-gate.yml` and
`deploy.yml`. `deploy.yml` was the only one of the four on Node 20. The release gate was verifying
on a runtime production does not run, so it could refuse a candidate that every other gate accepts,
which is exactly what happened.

This lane changes one line: `.github/workflows/deploy.yml:48`, `node-version: 20` -> `22`.

The authentication assertion is **preserved byte-for-byte** and is shown below still failing on the
condition it names.

Lane type governance, tier T1, executor claude.

## Verification

`pnpm type-check` and `pnpm test` run inside `pnpm verify:static`, which is the exact path
`deploy.yml` invokes. `pnpm verify` is not run to a PASS locally and no local PASS is claimed; see
EVIDENCE.

ASSERTIONS:

- [x] **A1 — The reported failure is reproduced, and the actual rejected error was inspected rather
  than inferred.** An instrumented copy of the test logged the thrown value on both runtimes before
  the assertion ran. On **both**, the guard rejects with the correct error class name and the
  correct code. Only `instanceof` differs. Verbatim output under EVIDENCE.
- [x] **A2 — It is not a fail-open.** On Node 20 the request was still refused —
  `PROBE: threw PrivilegedAccessDeniedError code= COMMAND_CENTER_AUTH_REQUIRED`. No request was
  admitted without authorization on either runtime. The assertion was correctly reporting an
  unsupported runtime, not a hole in the authentication path.
- [x] **A3 — The cause is module identity under Node 20's loader.** `../request-auth` resolves to
  two distinct module instances, so the test's imported `PrivilegedAccessDeniedError` is a different
  class object from the one `server-api.ts` throws. `error instanceof PrivilegedAccessDeniedError`
  is therefore `false` against an error that is, by class name and by code, exactly the expected one.
- [x] **A4 — Node 22 resolves it.** Same probe, same file, same assertion, Node 22.22.1:
  `instanceof= true`, `ok 1`.
- [x] **A5 — The authentication assertion is preserved and still protects the behaviour it names.**
  It was not weakened, relaxed, or rewritten; `git diff` touches no file under `apps/`. A mutation
  control deleting the missing-authorization refusal from `apps/command-center/src/lib/server-api.ts`
  makes it fail, and restoring it returns it to green. Output under EVIDENCE.
- [x] **A6 — The deploy's own verification path passes end to end at this anchor.**
  `pnpm verify:static`, the literal script `deploy.yml` runs, exits 0 with zero `not ok` lines
  across 101 suite blocks and 6097 tests. The command-center block reports `# tests 480 / # pass 480
  / # fail 0` with `ok 65 - cached service-role client reauthenticates every request` — the same
  suite, the same subtest number, and the same total that run 34031708984 reported as `not ok 65`,
  479/480.
- [x] **A7 — The change is one line and touches no reserved surface.** `git show --stat` reports
  `1 file changed, 1 insertion(+), 1 deletion(-)`. `package.json` is declared in the lane's
  `file_scope_lock` but was not needed and is untouched. No required-check configuration, branch
  protection, CODEOWNERS entry, merge-gate policy input, tier semantic, approval rule or bypass is
  changed. `deploy.yml` remains `workflow_dispatch`-only; nothing about when or whether a deploy
  fires is altered.

## EVIDENCE

### A1/A2/A3/A4 — the actual rejected error, both runtimes

Instrumented probe, same test body, same assertion, run against the built checkout:

```
===== node v20.20.2 =====
# PROBE: threw PrivilegedAccessDeniedError code= COMMAND_CENTER_AUTH_REQUIRED instanceof= false
not ok 1 - cached service-role client reauthenticates every request
  name: 'AssertionError'
# pass 0
# fail 1
===== node v22.22.1 =====
# PROBE: threw PrivilegedAccessDeniedError code= COMMAND_CENTER_AUTH_REQUIRED instanceof= true
ok 1 - cached service-role client reauthenticates every request
# pass 1
# fail 0
```

The class name and the code are identical on both. `instanceof` is the only difference, and it is
the only thing the assertion's first line checks.

### A5 — mutation control on the preserved assertion

Run on Node 22 against the unmodified `client-cache-auth.test.ts`:

```
=== A  baseline, guard intact, node v22.22.1 ===
ok 1 - cached service-role client reauthenticates every request
# tests 1 / # pass 1 / # fail 0

=== B  mutation: missing-authorization refusal deleted from server-api.ts ===
not ok 1 - cached service-role client reauthenticates every request
# tests 1 / # pass 0 / # fail 1

=== C  restored byte-for-byte ===
ok 1 - cached service-role client reauthenticates every request
# tests 1 / # pass 1 / # fail 0

--- git status --porcelain ---
(empty)
```

The mutated block was:

```ts
  const authorization = readHeader(input.headers, 'authorization');
  if (!authorization) {
    return denied(
      'COMMAND_CENTER_AUTH_REQUIRED',
      'Command Center authentication is required.',
    );
  }
```

B deletes the `if` and its `denied(...)` return, leaving the `readHeader` line. The assertion
detects it. The behavioural protection is intact.

### A6 — the deploy's own verification path

```
$ pnpm verify:static     # the literal script .github/workflows/deploy.yml runs
REAL_EXIT=0
not-ok lines: 0
aggregate over 101 suite blocks: tests 6097  pass 6097  fail 0

command-center suite block:
  ok 65 - cached service-role client reauthenticates every request
  # tests 480
  # pass 480
  # fail 0
```

`REAL_EXIT` is captured unpiped. An earlier attempt piped this command into `tail`, which reports
the pipe's last stage rather than the command — the UTV2-1704 defect — and produced a false green;
that result was discarded and the run repeated without a pipe.

**`pnpm verify` — not run to a PASS locally, and no local PASS is claimed.** `pnpm verify` reaches
`test:live-db` -> `test:db` -> `ci:assert-staging`, which refuses outside the `staging-ci` GitHub
environment. It cannot exit 0 on a developer machine. The required `verify` check on this PR, which
runs inside `staging-ci`, is the authoritative result. Locally `pnpm type-check` exits 0 and
`pnpm test` reports `# fail 0`, both inside the `verify:static` run above.

### A7 — the diff

```
$ git show --stat c7b170b1ecd10548e6bfcad38f895a3f1b3ffa5e
 .github/workflows/deploy.yml | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)

@@ -45,7 +45,7 @@ jobs:
       - name: Setup Node
         uses: actions/setup-node@v4
         with:
-          node-version: 20
+          node-version: 22
           cache: pnpm
```

## Known gaps

- **Other workflows still pin Node 20.** `grep -rn "node-version" .github/workflows/` returns 32
  files at 20. None of them runs the verify suite, and widening this lane to a repository-wide Node
  sweep would exceed its declared scope and delay the deployment candidate it exists to unblock.
  Recorded, not fixed here.
- **The underlying dual-module-instance resolution on Node 20 is not repaired**, because it does not
  need to be: Node 20 is below the repository's declared minimum. Should a Node 20 consumer ever
  become supported, the import graph under `apps/command-center/src/lib/` would need revisiting.
- **This lane does not verify the deploy end to end.** Dispatching `Deploy` is a reserved action.
  What is proven here is that the job that failed now passes at this anchor on the runtime the
  workflow will use.

## Commands run

```
pnpm type-check
pnpm test
pnpm verify
pnpm verify:static
pnpm exec tsx --test apps/command-center/src/lib/data/client-cache-auth.test.ts
pnpm exec tsx scripts/ci/r-level-check.ts
```
