# PROOF: WORK-2026100202

MERGE_SHA: pending merge

Execution source: bd1454d18950d98d714270c2145020ea435b7b7f
Execution approval: explicit Griff T1 approval in chat, 2026-10-02.
Merge approval: NOT GRANTED. This packet is for review, not authority to merge.

Issue: WORK-2026100202
Tier: T1
result: static_pass_live_ci_pending

## ASSERTIONS:

- [x] Actual workflow classifier routes a synthetic brand-only git diff to lightweight CI.
- [x] A synthetic brand + API-service git diff routes to normal staging proof.
- [x] T1/proof-required/missing tier and unknown comparisons cannot opt out.
- [x] Normal producer failure/cancellation/skipping and failed classification keep required verify red.
- [x] Same-run receipt enforcement and credential isolation remain unchanged on normal CI.
- [x] Pure-logo edits under T2/T3 take lightweight CI; actual sidebar sign-out edits take normal CI.
- [x] Both allowlisted components enforce pure rendering without imports/hooks/effects/interactive markup.
- [x] Sidebar before/after extraction: identical SSR HTML for all 24 collapsed/mobile/health/sign-out combinations.
- [x] Real isolated logo components render exact master paths; expanded/collapsed states and PNG exports pass.
- [ ] Authorized staging proof on the final PR HEAD (required for this T1 CI-policy lane).
- [ ] PM merge approval (not part of execution approval).

## EVIDENCE:

```text
pnpm exec tsx --test --test-name-pattern='Brand CI:' scripts/ci/staging-path-enforcement.test.ts
# tests 23
# pass 23
# fail 0
synthetic git diff: brand-only is lightweight; brand + runtime is normal: PASS

pnpm exec tsx --test --test-name-pattern='Brand component:' scripts/ci/staging-path-enforcement.test.ts
# tests 6
# pass 6
# fail 0

pnpm exec tsx --test --test-reporter=spec scripts/ci/staging-path-enforcement.test.ts
tests 68; pass 68; fail 0

pnpm exec tsx --test --test-reporter=spec scripts/ci/workflow-production-credential-guard.test.ts
tests 37; pass 37; fail 0

pnpm ops:automation-coverage-check
[automation-coverage] verdict=PASS fail=0 warn=1 classified=15
[executable-wiring] verdict=PASS required_roots=verify
tests total=594; unwired=119 (baselined=119 new=0)

pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 16 (two-dot R-level comparison; 15 scoped PR files via merge-base)
Rules matched: operator-ui; existing machine-matrix artifact present, no new R1-R5 required
```

The existing shadowed glob warning is baseline, not changed here. No test removal or new
`any` cast. The focused cases are directly registered in the existing script-wired staging guard;
name-filtered commands run each focused group independently.
package scripts and dependency metadata are unchanged.

## Verification

`pnpm verify` was run on the implementation tree. Its entire `verify:static` chain passed:
boundary/sync/alignment/coverage/env checks, lint, workspace type-check/build/tests,
production-post-migration tests, Smart Form fixture gate, and command validation.
It then failed at the deliberately preserved live-DB guard:

```text
> pnpm test:db && pnpm test:t1-proof:live
> pnpm ci:assert-staging && tsx --test apps/api/src/database-smoke.test.ts
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
Writable DB verification requires xskgrzbteyqdufktjrjx.
Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
ELIFECYCLE Command failed with exit code 1.
```

Direct `pnpm test:db` produced the same containment refusal before any writable suite.
This is not a code defect or a claim of passing local live proof. No credentials were
changed. T1 staging proof remains required in GitHub CI on the exact current PR HEAD.

Both explicit affected-app type-check and build commands passed. Smart Form's first
standalone build correctly refused missing production auth inputs; the new CI step now
provides only non-secret static auth placeholders and no database credentials. The
same filtered build then passed. Command Center's standalone build also passed.
The component harness uses real React SSR with routing stubbed and rejects unexpected
imports; it does not exercise service/database workflows or claim screenshot/E2E runtime proof.

CI classification for this policy fix must be normal (T1 plus workflow/test/policy files).
The review handoff will include its exact-head CI run and result separately, without
changing code or manufacturing a merge SHA. No merge performed.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1711

## PM Correction: 2026-10-03

PM CHANGES_REQUIRED was bound to 3391839fcd5c78c3d790d91fdf710c2d8736e945.
Only the logo/lockup was extracted; WorkspaceSidebar.tsx retains all navigation, sign-out,
health, and interaction code, and its path is excluded from the fast path. Smart Form's
existing BrandLogo.tsx is pure and unchanged. Dedicated component and purity checks pass.
Classifier 23/23; component/purity 6/6; combined staging guards 68/68; operator surface 16/16.
Current static QA is scoped React rendering, not a new live-browser or end-to-end product proof.
R-level matching retains the operator-UI QA requirement; no matrix or broader guard was changed.
Exact-head staging/CI is pending on the revised proof HEAD. Old-head success is not reused.
