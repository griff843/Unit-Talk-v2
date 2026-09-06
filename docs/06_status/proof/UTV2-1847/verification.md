# PROOF: UTV2-1847 — connected Smart Form browser submission

MERGE_SHA: pending merge

Execution SHA: d692e92c09b5d664b0428ef746ed59fba466c916  
Tier: T2 · Lane type: delivery-ui  
Result: pass

## ASSERTIONS:

- [x] Playwright starts both the isolated API and Smart Form dev server for every spec.
- [x] API startup/readiness failure stops Playwright with a non-zero exit; it cannot become a
      vacuous green.
- [x] A past event requests a `recentSince` freshness boundary rather than silently consuming stale
      offer data.
- [x] Browser-entered signed spread `-3.5` and American odds `+105` reach the real API and are read
      back from its isolated repository as numbers.
- [x] Structured fallback persists canonical away, home, and selected-team IDs.
- [x] Missing canonical coverage persists null IDs and explicit `canonical-coverage-gap` manual
      provenance.
- [x] Both connected submissions remain `validated`, return `outboxEnqueued: false`, and have no
      outbox row through the QA status endpoint.
- [x] No production credentials or live delivery target are used.
- [ ] CI invocation is not claimed by this delivery-ui slice. The work order assigns
      `.github/workflows/qa-fast.yml` and root `package.json` to a separate singleton-approved
      hygiene lane.

## EVIDENCE:

Focused connected browser run on the implementation SHA:

```
$ CI=1 pnpm --dir apps/smart-form exec playwright test -c playwright.config.ts \
    e2e/phase-one.spec.ts \
    --grep "mobile NCAAF moneyline|structured fallback persists|manual participant override persists"
Running 3 tests using 1 worker
3 passed (18.0s)
```

The two connected cases received HTTP 201 from `POST /api/submissions`, read their exact pick IDs
back through `GET /api/picks`, and checked `GET /api/qa/pick-status/:id` for a null outbox. The API
startup log identified `persistenceMode=in_memory`; the config blanks every Supabase credential and
sets `SYSTEM_PICK_SCANNER_ENABLED=false`.

Complete suite measurement during implementation (same substantive source; the later edit was a
comment-only clarification):

```
$ CI=1 pnpm --dir apps/smart-form test:e2e
29 passed
1 skipped — real-reference data was visibly unavailable, so the spec reported an explicit skip
```

Fail-loud inversion: a temporary HTTP 503 listener occupied port 4000, preventing the configured API
process from starting. Playwright exited 1 and printed:

```
Error: Process from config.webServer was not able to start. Exit code: 1
PASS: Playwright failed loudly when the configured API process could not start (exit=1)
```

## Verification

- [x] `pnpm verify:static`: exit 0. Includes environment and sync checks, lint, `pnpm type-check`,
      build, `pnpm test` (2,984 ops tests plus all aggregate suites), smart-form verify (143/143),
      and command/migration checks.
- [x] `pnpm exec tsx --test apps/api/src/submission-service.test.ts`: 89 passed, 0 failed.
- [x] Focused connected Playwright command above: 3 passed, 0 failed.
- [x] Complete `pnpm --dir apps/smart-form test:e2e`: 29 passed, 0 failed, 1 explicit skip.
- [x] Fail-loud inversion above: expected non-zero exit observed.
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: `Verdict: PASS`;
      `Rules matched: operator-ui`.
- [ ] `pnpm verify`: the packet explicitly replaces its writable live-DB half with `pnpm
      verify:static` locally. Writable proof is deferred because target identity is unparseable and
      must run in the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials for
      `xskgrzbteyqdufktjrjx`.

R-level lookup: `operator-ui` is the only matched rule. Its required `qa-experience-report` artifact
is present at `apps/qa-agent/artifacts/unit-talk-command_center-research_lines-operator/2026-05-13T14-30-59-lopam7/result.json`;
the R-level checker passes.

## Runtime Verification

The issue-specific runtime is deliberately local and contained: Chromium → Next dev server → API
HTTP route → isolated in-memory repository → API read-back. It neither contacts production nor
claims writable staging/database evidence.

## Merge SHA Binding

Merge SHA: pending merge  
PR: pending  
Approved PR head: pending merge  
Execution SHA: d692e92c09b5d664b0428ef746ed59fba466c916

## Anchor correction and orchestrator re-measurement

The executing agent originally recorded the execution SHA as
`3518fef1c120187c1acf3be38fc01a8c109eed14`. That commit is **not reachable from this branch** — it
is an orphaned pre-rebase copy of the same test commit, left behind when the lane was replayed onto
`a2efc4172`. Binding a proof to an unreachable commit would make every SHA row in this bundle
unverifiable, so the rows above now name the reachable anchor
`d692e92c09b5d664b0428ef746ed59fba466c916`.

The receipts are carried forward rather than discarded, because the two commits are provably
identical over the source this lane changes:

```
$ git diff --name-only 3518fef1c120187c1acf3be38fc01a8c109eed14 \
    d692e92c09b5d664b0428ef746ed59fba466c916 -- apps/ packages/
(empty)
```

The whole difference between them is `main`'s UTV2-1846 landing. Independently re-measured by the
orchestrator at the reachable anchor:

- `pnpm type-check` — exit 0, no diagnostics.
- `pnpm test` — tests 5977, pass 5977, fail 0, exit 0.
- `npx tsx scripts/ci/r-level-check.ts --base a2efc4172 --head a983b2276` — `Verdict: PASS`,
  `Changed files: 10`, `Rules matched: operator-ui`. Note this script forces
  `cwd: repoRoot`, so it must be given explicit SHAs rather than `HEAD` when invoked from a lane
  worktree; run with `--head HEAD` it silently measures the root checkout instead.

`pnpm verify` is not claimed locally: its live-DB half refuses outside the `staging-ci` GitHub
environment. The required `verify` check on this PR is the authoritative result.
