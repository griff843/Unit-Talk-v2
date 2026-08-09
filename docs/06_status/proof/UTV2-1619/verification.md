# PROOF: UTV2-1619 — bootstrap governance identity support

MERGE_SHA: <pending — bound post-merge by post-merge-lane-close.yml>

VERIFIED_SOURCE_SHA: 2aad12ced3bf7bbb844d4fd7155a86b743fb060d

Every command recorded below was executed against the source tree at
`2aad12ced3bf7bbb844d4fd7155a86b743fb060d`. Commits after that SHA change only proof
artifacts and the manifest's `pr_url`; no source, workflow, or test file moves.

ASSERTIONS:
- [x] Recognition checks for an existing ACTIVE lane identity before anything else; an active manifest-backed lane is never evaluated as a bootstrap action.
- [x] Bootstrap recognition never follows from an issue ID; it requires the `bootstrap/` branch namespace, which is GitHub-attested rather than read from the PR's files.
- [x] The lane-identity definition is byte-for-byte the one `scripts/ci/file-scope-guard.ts` uses (base-pinned manifest, active status set), so recognition and scope resolution cannot disagree.
- [x] A malformed or over-accumulated authorization file is unreachable for any PR that did not explicitly claim bootstrap identity.
- [x] All three consumers execute the resolver extracted from `origin/main`; none executes PR-head bootstrap authorization logic.
- [x] The decision artifact travels through `$RUNNER_TEMP`, outside the checkout; a decision resolving inside the repository root is refused before it is parsed.
- [x] Stale decisions are removed before resolution, and a resolver that cannot run fails the job rather than falling through.
- [x] A fabricated decision carrying the true `origin/main` SHA is still refused.
- [x] No production, runtime, migration, or delivery path is touched.

EVIDENCE:

## Verification

### End-to-end behavioral suite — the acceptance criterion

`scripts/ops/bootstrap-identity-e2e.test.ts` builds throwaway repositories with a
genuine `origin/main`, commits real branches, and spawns the shipped CLI the same way
the workflows do. No state is hand-fed. This replaces the previous unit tests, which
asserted on a lane manifest the real pipeline could not produce and therefore passed
while the pipeline failed.

Required behaviors and the tests that prove them:

| Behavior | Test |
|---|---|
| ordinary manifest-backed UTV2-1619 lane remains normal | E2E-1, E2E-1a, E2E-1b, E2E-1c |
| valid bootstrap action succeeds | E2E-2 |
| self-authorizing bootstrap fails | E2E-3, E2E-3a |
| malformed grants do not break unrelated PRs | E2E-4, E2E-4a |
| multiple grants do not break unrelated PRs | E2E-5, E2E-5a |
| fabricated decision files fail even with a valid-looking SHA | E2E-6, E2E-6a |
| authority SHA mismatch fails | E2E-7, with E2E-7a proving the check can pass |
| head-controlled consumer cannot bypass base authority | E2E-8 |

```
# tests 19
# pass 19
# fail 0
```

Combined with the unit and consumer suites
(`bootstrap-authorization`, `file-scope-guard`, `pr-review-packet`,
`bootstrap-head-fallback-guard`, `pre-merge-authorization`):

```
# tests 174
# pass 174
# fail 0
```

Adjacent regression suites (`workflow-hardening`, `executable-wiring`,
`ops-p0-containment-workflow`, `merge-gate-verdict`, `lane-manifest`, `lane-contract`):

```
# tests 154
# pass 154
# fail 0
```

### Pipeline verification against this branch

Run against the real branch, real `origin/main`, real changed-file set.

Resolver, phase-2 equivalent (grant read from `origin/main`, lane manifest on
`origin/main` is `done` and therefore not an active identity):

```
exit=0
{ "recognized": true, "valid": true, "issue_id": "UTV2-1619", "tier": "T2",
  "authority_source": { "ref": "origin/main", ... } }
```

File Scope Lock with that decision:

```
No file scope lock conflicts or scope violations detected.
exit=0
```

This is the deadlock closing. Before this change the same command reported
`No active lane manifest found for branch "bootstrap/utv2-1619-bootstrap-identity-support"`,
because recognition read the head manifest while the guard read the base one.

### Negative and adversarial results

Decision artifact planted inside the checkout at `.out/bootstrap-action.json`, carrying
the **true** `origin/main` SHA and `allowed_scope: ["**"]`:

```
FILE SCOPE LOCK CHECK FAILED
Errors:
- Invalid bootstrap governance action: Bootstrap action decision file is missing,
  malformed, or not from the trusted resolver.
```

Subverted head resolver (E2E-8): the PR rewrites
`scripts/ops/bootstrap-authorization.ts` to approve everything. The base-pinned copy is
what runs and refuses with the real reason (`no_authorization_file`). The test also
asserts that the head copy *would* have approved it, so the base pin is shown to be
load-bearing rather than assumed, and that the consumer refuses the head copy's output
anyway on the authority-SHA check — two independent controls, both demonstrated failing
the attack.

### Static verification

```
pnpm type-check                     exit 0
pnpm lint                           exit 0
pnpm test                           exit 0   # tests 4665 / pass 4665 / fail 0, 97 suites
YAML parse of all three workflows   clean
```

### R-level compliance

`scripts/ci/r-level-check.ts` executed against this diff:

```
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 18
Rules matched: (none) — no R-level artifacts required for this diff
exit 0
```

No rule in `docs/05_operations/r1-r5-rules.json` matches this diff, so no R-level artifact
is required. The check was run rather than assumed: a lane touching only governance
tooling, its tests, and its own proof directory triggers no R-level obligation.

### `pnpm verify`

`pnpm verify` was executed on this branch. It **exits 1**, and the reason is an
environment refusal rather than a defect in this lane:

```
$ pnpm verify
... verify:static, ci:db-client-boundary, ops:sync-check,
    ops:system-alignment-check, ops:automation-coverage-check,
    env:check, lint, type-check, build                          all pass
... test                                    tests 4779 / pass 4779 / fail 0
... verify:commands                         all pass
... test:live-db -> test:db -> ci:assert-staging
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL
  (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx.
  Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
exit 1
```

Every stage up to and including `verify:commands` passed, with the full suite green at
4779/4779. The single failing stage is `ci:assert-staging`, the guard that refuses
writable DB verification against anything but the staging project. That guard is working
as designed; a local checkout has no `CI_SUPABASE_*` credentials, so `pnpm verify` cannot
reach green outside the `staging-ci` GitHub environment for any lane.

The authoritative verify signal is therefore the CI `verify` required context, which
**passed** on `2aad12ced3bf7bbb844d4fd7155a86b743fb060d` (PR #1399) — running in the
environment the guard requires. This proof does not claim a green local `pnpm verify`,
because there was not one.

## Known limitation — phase-1 transition

`origin/main`'s copy of `scripts/ops/bootstrap-authorization.ts` has no CLI entry point,
so it cannot answer `--resolve-action`. Each consumer probes for that support and, when
absent, records `state=unsupported` and grants no bootstrap identity. That is the
fail-closed outcome; the alternative — falling back to the PR's own resolver — is the
thing this lane exists to forbid.

Consequence for this PR: File Scope Lock stays red with
`No active lane manifest found`, exactly as it was on PRs #1388, #1389, #1390 and #1391.
It is not a required check (`verify`, `Executor Result Validation`, `Merge Gate`,
`P0 Protocol` are), and this PR neither introduces nor worsens that failure. Once this
lands, the mechanism is live for the next bootstrap action.
