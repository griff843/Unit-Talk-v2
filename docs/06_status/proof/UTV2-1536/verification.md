# PROOF: UTV2-1536
MERGE_SHA: 08954e79453246f7c5550a4655e1aa6a9cd586f6

ASSERTIONS:
- [x] Audited the repo for hard-coded stale concurrency ceilings presented as current policy (2 Claude / 4 Codex / 6 lanes / 2-4-6 / older 5-lane-2-Claude-3-Codex variants)
- [x] AGENTS.md executor-limits table and total-cap line no longer embed numbers; both defer to docs/governance/CONCURRENCY_CONFIG.json and pnpm ops:execution-state
- [x] .claude/agents/lane-governor.md (found on audit, far more stale than AGENTS.md) fully rewritten to derive every threshold from the live policy/config at runtime, matching its own pre-existing "do not use hardcoded values" instruction
- [x] .claude/commands/dispatch.md, dispatch-board.md, lane-management.md, loop-dispatch.md, three-brain.md audited and confirmed already fully config-driven -- no change needed
- [x] Canonical historical records (CERT_BOARD.md, PROGRAM_5_ACTIVATION.md, STAGE2_ACTIVATION_CHECKLIST.md, UTV2-1504 proof) left untouched -- each is either explicitly banner-marked SUPERSEDED/HISTORICAL or an accurate dated record
- [x] scripts/ci/concurrency-doc-drift-guard.ts added: narrow explicit allowlist (AGENTS.md, .claude/agents/lane-governor.md, .claude/commands/*.md), static stale-literal patterns plus a config-driven numeric-claim cross-check against the live CONCURRENCY_CONFIG.json base values
- [x] Guard wired into verify:static and verify:quick (both part of pnpm verify, the required CI check) and into test:ops
- [x] 19 new tests: stale-literal detection for every known variant, config-mismatch detection, canonical-reference/current-value acceptance, historical-provenance-framing exemption, and proof that the allowlist -- not content leniency -- protects docs/06_status/proof|lanes|INCIDENTS paths
- [x] pnpm verify green end-to-end, including pnpm test:db (7/7 pass) and the full 14-file test:t1-proof:live chain against real Supabase (zfzdnfwdarxucxtaojxm)
- [x] r-level-check PASS, no R-level artifacts required for this diff

EVIDENCE:
```text
$ pnpm exec tsx scripts/ci/concurrency-doc-drift-guard.ts
[concurrency-doc-drift-guard] verdict=PASS files_checked=21 findings=0
[concurrency-doc-drift-guard] live base config: total=10 claude=4 codex=6

$ npx tsx --test scripts/ci/concurrency-doc-drift-guard.test.ts
1..19
# tests 19
# pass 19
# fail 0

$ pnpm test:db
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 7
Rules matched: (none) — no R-level artifacts required for this diff
```
```text
$ pnpm verify
(full gate: env:check, lint, type-check, build, test, smart-form verify,
verify:commands, test:db, test:t1-proof:live -- exit code 0)
```

**Status: PR not merged.** No merge SHA is invented. The `MERGE_SHA:` field above references
this branch's own implementation commit (an ancestor of the PR head), per
`executor-result-validator.yml`'s documented implementation-commit-as-ancestor pattern.
`evidence.json`'s `sha_binding.merge_sha` remains `null`.

---

# UTV2-1536 Verification

## Verification

| Check | Result |
| --- | --- |
| `pnpm exec tsx scripts/ci/concurrency-doc-drift-guard.ts` | Passed — verdict=PASS, 21 files checked, 0 findings, live base config total=10 claude=4 codex=6 |
| `npx tsx --test scripts/ci/concurrency-doc-drift-guard.test.ts` | Passed — 19 tests, 19 pass, 0 fail |
| `pnpm verify` | Passed — full gate (env:check, lint, type-check, build, test, smart-form verify, verify:commands, test:db, test:t1-proof:live) completed with exit code 0 |
| `pnpm test:db` | Passed — live database repository smoke test against real Supabase (7 tests, 0 failures) |
| `pnpm test:t1-proof:live` | Passed — all 14 live-DB T1 proof files green (0 failures across the chain) |
| `pnpm exec tsc -b tsconfig.json` | Passed — re-run standalone after rebasing onto a newer `origin/main`, exit code 0 |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | Passed — Verdict: PASS, 7 changed files, no R-level artifacts required for this diff |

`pnpm test:db` node:test result:

```text
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

`scripts/ci/concurrency-doc-drift-guard.test.ts` node:test result:

```text
1..19
# tests 19
# suites 0
# pass 19
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

## Issue-specific verification

**Audit.** Grepped the repository (excluding `node_modules`, `.git`, `.out`) for stale
concurrency literals presented as current policy: `"2 Claude"`, `"4 Codex"`, `"6 lanes"` /
`"six lanes"`, `"max 4 Codex"`, `"2/4/6"`, and a broader `"[0-9] active lanes?"` sweep. Findings
were classified per the task's rubric:

- **Current-instruction, fixed in this diff:**
  - `AGENTS.md` — the executor-limits table hard-coded "Claude Code | 2 active lanes",
    "Codex CLI | 4 active lanes", and "Current total cap: 6 active execution lanes" (all
    pre-a-prior-concurrency-ramp-lane values). Now defers entirely to
    `docs/governance/CONCURRENCY_CONFIG.json` / `pnpm ops:execution-state -- --json`.
  - `.claude/agents/lane-governor.md` — far more stale than AGENTS.md: it cited a
    5-lane total / 2-Claude / 3-Codex baseline left over from an even older trial period,
    contradicting its own stated principle ("derive every threshold from the policy at
    runtime"). Every hard-coded threshold (total, per-executor, per-type caps, and the
    output-format template's `/5`, `/3` denominators) was rewritten to read live values
    instead.
- **Current-instruction, already correct (no edit needed):** `.claude/commands/dispatch.md`,
  `dispatch-board.md`, `lane-management.md`, `loop-dispatch.md`, `three-brain.md` — all already
  cite `CONCURRENCY_CONFIG.json` / `ops:execution-state` / `ops:lane-maximizer` exclusively and
  contain explicit "do not copy numeric caps into this command" language. `docs/05_operations/DELEGATION_POLICY.md`
  contains no lane-count literals at all.
- **Canonical historical record, left untouched:** `docs/06_status/CERT_BOARD.md`,
  `docs/06_status/programs/PROGRAM_5_ACTIVATION.md`, `docs/06_status/STAGE2_ACTIVATION_CHECKLIST.md`
  (each explicitly banner-marked "SUPERSEDED / HISTORICAL — retained for audit history only");
  `docs/06_status/proof/UTV2-1504/verification.md` (accurate record of the base config at the
  time it was captured, framed with "the base 6 total / 2 Claude / 4 Codex limits").
- **Test fixture, left untouched:** `scripts/ops/concurrency-simulation.test.ts` — its `POLICY`
  fixture deliberately uses small arbitrary constants (`total: 6, claude: 2, codex: 4`) to test
  the generic mechanism at a scale distinct from production, with an adjacent `PROD_POLICY`
  fixture in the same file that already mirrors the real `10/4/6` config and is commented as
  such. `scripts/ops/workflow-hardening.test.ts` already contains pre-existing anti-drift
  assertions (`assert.doesNotMatch(command, /max 2 Claude/)`, etc.) guarding
  `dispatch.md`/`dispatch-board.md`/`loop-dispatch.md` against exactly this class of
  regression — left as-is, not duplicated.
- `docs/governance/LANE_CONCURRENCY_POLICY.md` already correctly states the current 10/4/6
  ceiling as canonical and narrates the prior 6/2/4 ceiling with explicit "prior"/"superseded"/
  "stabilization-era" historical framing — left untouched (it is the canonical human-readable
  policy doc, not an audited target for this lane).

**Drift-guard design.** `scripts/ci/concurrency-doc-drift-guard.ts` is a narrow-allowlist guard,
not a repo-wide scan (`AGENTS.md`, `.claude/agents/lane-governor.md`, and every
`.claude/commands/*.md`, resolved dynamically from the directory listing — 21 files today). Two
independent layers:

1. **Static stale-literal patterns** — a fixed list of regexes matching known-old phrasings
   (`"Claude Code | 2 active lanes"`, `"Codex CLI | 4 active lanes"`, the even-older
   `"Codex CLI | 3 active lanes"`, `"6 lanes total"` / `"6 active execution lanes"`,
   `"total... 5"`, bare `"2/4/6"`, `"2 Claude + 4 Codex"`, `"1 Claude + 2 Codex"`, and
   `"max/up to 2 Claude"` / `"max/up to 4 Codex"`). A line is exempt if it carries clear
   historical framing (`prior`, `superseded`, `legacy`, `stabilization-era`, etc.), so a doc is
   still allowed to narrate what the old ceiling used to be.
2. **Config-driven claim extractor** — recognizes the specific table-row / "current total cap"
   phrasings these docs actually use, extracts the claimed number, and compares it against the
   *live* base values in `CONCURRENCY_CONFIG.json` via `loadConcurrencyConfig()` (not
   `getEffectiveConfig()` — base, not trial, since these docs describe the ratified default).
   This is the self-updating half: if the config changes again and a doc's numeric claim isn't
   updated to match, CI fails without this guard's own patterns needing an edit.

Deliberately did **not** extend the existing `scripts/ops/system-alignment-check.ts`
(`checkActiveControlPlaneStaleReferences`) for this: that check already walks a broad
`CONTROL_PLANE_ROOTS` set (`AGENTS.md`, `CLAUDE.md`, `.agents`, `.claude`, `.github`, `docs`,
`scripts`) excluding only `docs/archive` and `.claude/worktrees` — adding concurrency-ceiling
patterns there would have risked exactly the noisy false-positive class the task warned against
(flagging `docs/06_status/proof/**`, `docs/06_status/lanes/**`, and other historical text that
legitimately contains an old number). A dedicated `scripts/ci/*` script with its own tight
allowlist, following the same PASS/FAIL/JSON-output conventions as
`scripts/ci/file-scope-guard.ts` and `scripts/ci/r-level-check.ts`, keeps the blast radius
exactly at the files this task is about.

**Wiring.** Added `ops:concurrency-doc-drift-guard` to `package.json` and inserted it into both
`verify:static` and `verify:quick` (immediately after the existing `ops:system-alignment-check`
step) — both are already part of `pnpm verify`, which is the required check run by
`.github/workflows/ci.yml` on every PR. Also added the new test file to the `test:ops` aggregate
so it runs under `pnpm test`.

**Test coverage (19 new tests in `scripts/ci/concurrency-doc-drift-guard.test.ts`).** Covers: (1)
the real, current allowlisted files pass with zero findings; (2) each of the 8 known-stale
literal variants is independently detected; (3) the config-driven extractor flags a numeric claim
that doesn't match the live config; (4) `CONCURRENCY_CONFIG.json` references and the current
correct numeric values are accepted, not flagged; (5) historical provenance framing (mirroring
`LANE_CONCURRENCY_POLICY.md`'s real provenance note) is exempt; (6) the default allowlist never
includes `docs/06_status/proof/**`, `docs/06_status/lanes/**`, or `docs/06_status/INCIDENTS/**`,
and a fixture reproducing real historical proof wording is shown to only escape detection
*because it is excluded from the allowlist*, not because the content itself would pass if
scanned (proving the safety mechanism is exclusion, not leniency); (7) the guard's live base
config equals both `loadConcurrencyConfig()`'s raw values and `execution-state.ts`'s
`MAX_CLAUDE_LANES`/`MAX_CODEX_LANES` exports (which back `dispatch_slots.*.max` in
`pnpm ops:execution-state -- --json`), so the two can never silently diverge while no trial is
active.

## Commit binding

Evidence was captured for commit `8e3b3039816500ddd2cc71e41ff43493f78cbd37` (the implementation
+ proof-bundle content), after rebasing onto a newer `origin/main` (which had independently
picked up an unrelated `ci.yml` audit-step fix while this lane's live-DB proof suite was
running). `pnpm exec tsc -b tsconfig.json` was re-run standalone post-rebase as a fast sanity
check (exit 0); the full `pnpm verify` run captured above predates the rebase by content but is
unaffected by it (the rebase touched only `.github/workflows/ci.yml`, which this lane does not
modify). The branch was rebased a second time after `origin/main` advanced again (a merged,
unrelated lane) mid-review, which also rewrites every commit SHA on this branch, including the
implementation commit referenced by `MERGE_SHA:` above. `pnpm exec tsc -b tsconfig.json`,
`pnpm exec tsx scripts/ci/concurrency-doc-drift-guard.ts`, and
`npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` were all re-run standalone
after each rebase (both green) as a fast sanity check; no implementation or guard content changed
across either rebase.

## SHA Binding

The operative, mechanically-checked Head SHA is whatever the PR's live head SHA is at review
time (`gh pr view 1218 --json headRefOid`) and the exact SHA embedded in the most recent
`executor-result/v1` comment -- not a value hand-copied into this narrative section, which would
go stale the moment another commit lands (as happened twice already during this review). See
`evidence.json`'s `sha_binding` block for the same caveat.
Merge SHA: pending — will be bound automatically by `post-merge-lane-close.yml`'s
`ops:proof-generate --merge-sha` after merge, per repo convention.
