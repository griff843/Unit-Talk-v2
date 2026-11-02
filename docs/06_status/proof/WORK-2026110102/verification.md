# PROOF: WORK-2026110102

MERGE_SHA: pending merge

Issue: WORK-2026110102
Tier: T2
Verified source SHA: `4856c23593c326059d920bcddb09b469c1fa1b63`
result: local_static_pass_full_verify_blocked_on_staging_db_exact_head_ci_pending

## ASSERTIONS:

- [x] Legacy absence and member pins add no label.
- [x] Staff-canary on the pick alone, outbox alone, or both renders the required canary text.
- [x] Unknown/non-string pins, malformed declarations and explicit disagreements produce the fail-closed text.
- [x] The detail outbox read adds only `payload`; its filter/order and raw payload handoff are pinned by a focused GET-only test.
- [x] Private and fail-closed recap outcomes refer to the private staff destination.
- [x] Eighteen original/current member markup comparisons and eighteen original/current member recap JSON comparisons are byte-identical.
- [x] The canary mutation is killed and the restored focused tests pass.
- [x] Six synthetic local browser checks show the correct accessible label and no horizontal overflow.
- [ ] Full `pnpm verify` green in CI at the final head: pending Production Claude opening the PR when staging capacity is free.

## EVIDENCE:

Focused command (38 passed, zero failed):

```sh
pnpm exec tsx --test apps/command-center/src/lib/delivery-audience-label.test.ts apps/command-center/src/lib/human-capper-recap.test.ts apps/command-center/src/lib/data/queues-governed-population.test.ts apps/operator-web/src/server.test.ts apps/command-center/src/lib/server-api.test.ts
```

The final Command Center suite passed 749/749 inside repository verification, including the additional query test. No tests were removed.

`pnpm type-check`: PASS. `pnpm --filter @unit-talk/command-center type-check`: PASS.
`git diff --check`: PASS.

### Mutation

Temporarily replaced `return STAFF_CANARY_LABEL;` with `return null;` in `delivery-audience-label.ts`, preserving the rest of the resolver. Ran:

```sh
pnpm exec tsx --test apps/command-center/src/lib/delivery-audience-label.test.ts
```

Exit 1. Test `staff-canary on the pick only, outbox only, and both gets the canary label` failed:

```text
actual: null
expected: 'Staff canary: private staff destination, hidden from members'
operator: strictEqual
```

The source was restored in a `finally` block. The final focused command passed. The mutation was not committed. Full mutation output is in `.out/ops/WORK-2026110102/mutation.log`.

### Member rendering

The harness imports the original governed-detail component from baseline `03ce05cbf` and the updated component, then compares `renderToStaticMarkup` byte for byte across six states and three legacy/member outbox variants (18 comparisons). It covers absent metadata, Track Only, explicit members, voided, delivered receipt and killed delivery. The recap harness compares original/current serialized verdicts for nine inputs using both default and explicit member visibility (18 comparisons).

```sh
pnpm exec tsx --tsconfig apps/command-center/tsconfig.json .out/ops/WORK-2026110102/member-render.tsx
pnpm exec tsx .out/ops/WORK-2026110102/member-recap.ts
```

Both passed. Existing member tests remain unchanged.

### Synthetic browser proof — not deployed acceptance

A real local Next server rendered `/picks/members`, `/picks/staff-canary` and `/picks/mismatch` against a read-only PostgREST-shaped fixture server on loopback. The final captures use a valid synthetic server-allowlist authorization and confirmed synthetic delivery receipt. The fixture rejects writes. Screenshots carry a visible “SYNTHETIC LOCAL FIXTURES — NOT DEPLOYED ACCEPTANCE” banner.

| Pick | Viewport | Result | Capture |
|---|---|---|---|
| members | 1440×1000 | PASS | `.out/ops/WORK-2026110102/synthetic-members-1440.png` |
| staff-canary | 1440×1000 | PASS | `.out/ops/WORK-2026110102/synthetic-staff-canary-1440.png` |
| mismatch | 1440×1000 | PASS | `.out/ops/WORK-2026110102/synthetic-mismatch-1440.png` |
| members | 390×844 | PASS | `.out/ops/WORK-2026110102/synthetic-members-390.png` |
| staff-canary | 390×844 | PASS | `.out/ops/WORK-2026110102/synthetic-staff-canary-390.png` |
| mismatch | 390×844 | PASS | `.out/ops/WORK-2026110102/synthetic-mismatch-390.png` |

Assertions check HTTP 200, the governed truth panel, exact label presence/absence, delivery receipt panel, label text in the accessibility snapshot, no page JavaScript errors and no horizontal page overflow. The label is ordinary readable paragraph text. Browser harness: `.out/ops/WORK-2026110102/browser.mjs`; fixture: `fixture-server.mjs` in that directory. Captures and accessibility snapshots are local generated evidence.

### R-level evidence

```text
pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Rules matched: operator-ui
```

The checker finds the repository's pre-existing QA artifact under `apps/qa-agent/artifacts/`; that historical artifact is not presented as this issue's browser proof. Fresh issue-specific checks and captures are recorded above and in `evidence.json`.

## Verification

`pnpm verify:static` (invoked by `pnpm verify`): PASS. Its boundary, sync/alignment, environment, lint, type-check, build, repository tests, post-migration tests, Smart Form verification and command/migration checks all completed successfully. Smart Form E2E was not enabled by that package's existing verification configuration; this lane's six Command Center browser checks ran separately.

`pnpm verify`: exit 1 at the subsequent staging DB guard. This is not a green full gate. Observed final output:

```text
[command-manifest] Verified 14 command definition(s)
[check-migration-versions] 139 migration file(s) verified — no duplicate versions.
[lint-migrations] 138 migration file(s) checked — no findings.
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```

Full output: `.out/ops/WORK-2026110102/verify.log`. The initial run encountered generated `next-env.d.ts` lint drift from the local Next dev server; the generated change was restored before the successful static run.

Writable live-DB proof is BLOCKED/DEFERRED. The packet recorded an unresolved target (host=unparseable); the actual local guard refused the loopback host=127.0.0.1 with ref=unidentified. Writable DB verification requires `xskgrzbteyqdufktjrjx` through the staging-ci GitHub environment with `CI_SUPABASE_*` credentials. No local writable DB proof or production mutation is claimed.

The initial checkpoint command returned `execution_checkpoint_missing` in the lane worktree. The authoritative checkpoint was then found in the parent control worktree; completed phases and findings are recorded there using the supported `--dir` option.

## Provenance and review sequencing

Pre-existing wrapper routing evidence records `gpt-6.1-sol` / `medium`, profile `codex-sol-medium`, generated at 2026-11-02T10:02:18.079Z. The current attempt cannot independently observe the runtime model or effort; that limitation is explicit in `model-routing.json`, rather than inferred from the declaration.

No PR is opened, per the packet's staging-slot sequencing override. The handoff is `.out/ops/ready-for-pr/WORK-2026110102.md`. Production Claude owns opening the PR and applying `tier:T2`. Ask Production Claude before any subsequent push after a PR exists. No executor-result attestation, PM approval, merge, readiness, lane finalization or post-merge reconciliation is claimed.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
