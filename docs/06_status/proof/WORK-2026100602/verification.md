# PROOF: WORK-2026100602

MERGE_SHA: pending merge

Issue: WORK-2026100602
Tier: T1
Lane type: governance
Implementation SHA: 7fb68863fca23c0f6980fbcbb78b792a7bcb3c9d
result: static_pass_live_db_deferred_to_staging_ci

## ASSERTIONS:

- [x] Ordinary preflight returned `PASS`; `waivers` was empty, ownership checks PL1-PL6 passed,
  and PT1 recorded the documented `deferred_to_ci` containment outcome.
- [x] Ordinary lane-start created this started governance lane without merged-recovery flags,
  special authorization, ownership exemptions, or admission-script changes.
- [x] The original evidence diff is exactly one deleted line: the forbidden legacy top-level
  `merge_sha: null`.
- [x] A normalized comparison to `origin/main` proves every other original evidence key and value
  is byte-semantically unchanged, including the original runtime evidence and execution provenance.
- [x] The original lane manifest remains `merged`, bound to PR #1718 and merge
  `9aef8ee772ea5a569f34619ad3089c1a51490c7d`, with its failed reconciliation history preserved.
- [x] No runtime proof was regenerated or manufactured for WORK-2026100501, and no passing
  truth-check or closure state was authored.

## EVIDENCE:

Ordinary admission receipt:

```text
verdict=PASS
waivers=[]
PL1=pass PL2=pass PL3=pass PL4=pass PL5=pass PL6=pass
PT1=blocked_by_containment
t1_live_db_precondition=deferred_to_ci
```

Exact repair checks:

```text
git diff --numstat -- docs/06_status/proof/WORK-2026100501/evidence.json
0  1  docs/06_status/proof/WORK-2026100501/evidence.json

jq -S 'del(.merge_sha)' <origin/main evidence> == jq -S <repaired evidence>
PASS
```

The existing `ops:proof-check WORK-2026100501 --json` still truthfully reports the original
historical stale-source condition and null evidence commit. This lane does not rewrite those
fields; canonical post-merge closeout must evaluate and bind the actual merge authority.

## Verification

- `pnpm exec tsx --test scripts/ops/proof-schema.test.ts` — PASS: 108 tests, 0 failures,
  including the regression that forbids schema-v2 top-level `merge_sha` and requires the
  canonical nested merge slot.
- `pnpm type-check` — PASS as part of the measured `pnpm verify` static chain.
- `pnpm test` — PASS as part of the measured `pnpm verify` static chain; all repository test
  groups completed with zero failures.
- `pnpm verify:static` — PASS as the first phase of `pnpm verify`, including lint, type-check,
  build, aggregate tests, production-post-migration tests, Smart Form verification, command
  manifest checks, and migration checks.
- `pnpm verify` — static phase PASS; writable phase correctly REFUSED before DB access because
  the local target resolved as `host=127.0.0.1 ref=unidentified`, not staging project
  `xskgrzbteyqdufktjrjx`.
- `pnpm test:db` — invoked by `pnpm verify` and correctly REFUSED at the same pre-write target
  guard. Writable proof is deferred to protected exact-HEAD `staging-ci` with `CI_SUPABASE_*`.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS: 5 changed
  files, no R-level rules matched.
- `FILE_SCOPE_PR_BRANCH=codex/work-2026100602-proof-closeout pnpm exec tsx
  scripts/ci/file-scope-guard.ts --base origin/main --head HEAD --manifest-source git` — PASS.
- `git diff --check` — PASS.

## Runtime Verification

This governance repair changes no runtime behavior and makes no new runtime claim. The original
WORK-2026100501 runtime evidence is preserved, not rerun. For this T1 repair lane, local writable
DB verification is blocked/deferred by the target guard and must be supplied by exact-HEAD
protected staging CI.

## Model Routing

This session is the sanctioned `ops:codex-exec` child and did not recursively invoke it. The outer
executor owns and persists `model-routing.json` only after this child exits, so no provenance is
hand-authored here.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1720
