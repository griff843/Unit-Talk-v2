# PROOF: WORK-2026102202

MERGE_SHA: pending merge

Issue: WORK-2026102202

Tier: T2

Lane type: delivery-ui

Execution SHA: `9eb932b13ee2df6ae7dfab8e2270f7e1af2028a0`

PR: https://github.com/griff843/Unit-Talk-v2/pull/1772

result: local_static_pass_db_deferred

## ASSERTIONS:

- [x] Checkout remains disabled when the public gate is unset, empty, false, malformed,
      case-changed, or padded.
- [x] The exact gate value `true` assigns the verified Whop checkout URL to VIP only.
- [x] Trial and VIP+ checkout hrefs remain null; no other membership receives a checkout href.
- [x] The disabled VIP tier preserves `Website checkout unavailable`, `Understand VIP`, and the
      existing `/how-it-works` informational href.
- [x] The pricing page is the only caller that opts into checkout rendering, so shared homepage
      cards retain their existing unavailable behavior.
- [x] External checkout links use a new tab with `noopener noreferrer`.
- [x] No deployment environment or publishing configuration changed.

## EVIDENCE:

Focused test result:

```text
tests 8
pass 8
fail 0
duration_ms 927.185245
```

R-level result:

```text
Verdict: PASS
Changed files: 9
Rules matched: (none) — no R-level artifacts required for this diff
```

## Verification

- [x] `pnpm type-check`: exit 0.
- [x] `pnpm test`: exit 0.
- [x] `pnpm verify:static`: exit 0, including lint, type-check, build, full tests, Smart Form
      verification, command-manifest checks, and migration checks.
- [x] `NEXT_PUBLIC_SITE_URL=https://unit-talk.com pnpm exec tsx --test 'apps/web/src/lib/site-config.test.ts'`:
      8 pass, 0 fail.
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS; 9 changed files;
      no R-level rules or additional artifacts required.
- [ ] Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL
      (`host=unparseable`). Writable DB verification requires `xskgrzbteyqdufktjrjx`. Run it through
      the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials.
- [ ] `ops:exec-checkpoint` could not record phases because the execution checkpoint subsystem
      returned `execution_checkpoint_missing` for `WORK-2026102202`; no phase completion is claimed.
- [ ] Protected exact-head CI, PM approval, governed merge, lane finalization, and post-merge
      orchestration reconciliation remain pending.

No deployment, publication, environment enablement, or production access was performed.

## Merge SHA Binding

Merge SHA: pending merge

PR: https://github.com/griff843/Unit-Talk-v2/pull/1772

Execution SHA: `9eb932b13ee2df6ae7dfab8e2270f7e1af2028a0`
