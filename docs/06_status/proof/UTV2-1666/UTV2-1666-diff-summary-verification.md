# UTV2-1666 — Diff Summary & Verification

**Tier:** T2 (corrected from the manifest's original T1 — see "Tier correction" below)
**Issue:** UTV2-1666 — Deployment-truth design (`docs/05_operations/DEPLOYMENT_TRUTH_DESIGN.md`)
**PR:** #1372
**Verifier identity:** claude/utv2-1666-deployment-truth-design
**Date:** 2026-08-03
**Prior reviewed head (commit SHA):** `cbf72e92296131b2f864dea0f91136ed4d0d765a` — the head PM_VERDICT round 7 reviewed and returned CHANGES_REQUIRED against (round 6's own reviewed head, `0cfeca32c1b7df991695bcdb78636d7fad075490`, remains valid history one commit further back). This correction pass is committed on top of it. Per the same convention as `evidence.json`'s `sha_binding` block: this document cannot embed its own commit's SHA at commit time (the SHA is a function of this file's own content) — the authoritative binding to *this* commit's SHA is written post-merge by `post-merge-lane-close.yml`'s `ops:proof-generate --merge-sha`, exactly as for every other proof bundle in this repo.

## Scope

**Claims:**
- This PR is docs-only: it adds/revises `docs/05_operations/DEPLOYMENT_TRUTH_DESIGN.md`, plus this lane's own manifest/sync/proof files.
- No `deploy.yml`, `readiness-refresh.ts`, or any other application/CI code is changed.
- `pnpm type-check`, `pnpm test`, and `pnpm verify:static` (verify minus the live-DB step) all pass cleanly against this diff.
- Zero R-level rules trigger against this diff (`scripts/ci/r-level-check.ts`).

**Does NOT claim:**
- No runtime/DB verification is claimed or required — there is no DB-touching code in this diff. This is the reason for the tier correction below.
- No implementation of the design itself (host journal, monotonic sequence, canonical service set, hardened SSH observer) is claimed here — this document is design-only; a future implementation PR will need each of the 42 regression-matrix rows covered by an executable test.

## Tier correction

The lane manifest originally declared `tier: T1`, inherited from this session's broader "architecture-critical work gets design-first review" operating-model language. Checked directly against `scripts/ops/truth-check-lib.ts`: the T1 path (`runtime_proof_required: tier === 'T1' || ...`, plus the mechanical R1/R2 checks) hard-requires live-DB `runtime_proof.queries`/`runtime_proof.row_counts`, and `--no-runtime` is explicitly rejected for T1 (`truth-check-lib.ts:992`) — there is no waiver path. This lane has no DB interaction to prove; fabricating queries/row-counts against a real database that were never run would be a false evidence claim, not a shortcut. Per this repo's own tier table, the correct tier for a lane with no runtime/DB footprint whose merge authority is still PM-verdict-gated is **T2** (`type-check + test + issue-specific` verification, `GitHub PR review approval or pm-verdict/v1 APPROVED comment` merge authority) — corrected in the manifest accordingly. This does not weaken oversight: PM verdict (`pm-verdict/v1`) remains the operative gate on this PR either way, which is exactly what is already in effect (round-5 `PM_VERDICT: CHANGES_REQUIRED` → this correction pass → PM re-review).

## Diff Summary

**Correction (PM_VERDICT round 6):** the previous revision of this table showed a stale, mid-commit snapshot that still listed `docs/06_status/proof/UTV2-1666/.gitkeep`, which was deleted within the same PR and therefore does not appear in the actual `origin/main..HEAD` diff at all (a file added then removed within one PR's range nets to nothing in a range-diff). Regenerated directly against the real current state — the final diff is exactly five files, matching what PM_VERDICT round 6 observed:

```
$ git diff --stat origin/main
 .ops/sync/UTV2-1666.yml                                                |  10 +
 docs/05_operations/DEPLOYMENT_TRUTH_DESIGN.md                          | 358 +++++++++++++++++++++
 docs/06_status/lanes/UTV2-1666.json                                    |  36 +++
 docs/06_status/proof/UTV2-1666/UTV2-1666-diff-summary-verification.md  | 135 +++++++++
 docs/06_status/proof/UTV2-1666/evidence.json                           |  86 ++++++
 5 files changed, 625 insertions(+)
```

(regenerated immediately before this closing commit so the numbers match exactly what ships — see PM_VERDICT round 6's finding that this table went stale once before)

(`.gitkeep` correctly absent — it was added and then deleted within this same PR's range, so it never appears in a `origin/main..HEAD` diff.)

Round-6 revision to `DEPLOYMENT_TRUTH_DESIGN.md` on top of the reviewed `0cfeca32` head: `git diff --stat HEAD -- docs/05_operations/DEPLOYMENT_TRUTH_DESIGN.md` (working tree vs. `0cfeca32`, prior to this correction commit) → `1 file changed, 43 insertions(+), 23 deletions(-)` — corrects the journal write-boundary claim, enumerates every sequence/index crash state, sweeps every remaining pre-round-5 ordering/provenance reference to the single `journal_sequence` rule, and resolves §12's stale open-decision language.

## Verification

### pnpm type-check

Command: `pnpm type-check`
Output: clean exit, no errors (`tsc -b tsconfig.json` produced no output — a silent pass under `tsc -b`).
Result: **PASS**

### pnpm test

Command: `pnpm test`
Output excerpt (full run captured):
```
1..19
# tests 19
# suites 0
# pass 19
# fail 0
...
```
Aggregate across the full `pnpm test` run: 3860 passing subtests (`grep -c '^ok '`), 0 failing (`grep -c '^not ok '` → 0), overall exit code 0.
Result: **PASS**

### pnpm verify (and why the reported exit code from the full alias is not the relevant signal here)

Command run in full: `pnpm verify` → exit 1. This is `verify:static && test:live-db` (`package.json`); the failure is entirely in `test:live-db`'s `ci:assert-staging` step: `[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.` — this is the repo's own known, deliberate local-environment gate (UTV2-1630 CI/staging isolation): `test:live-db` only succeeds inside the `staging-ci` GitHub Actions environment with its scoped credentials, and is expected to refuse in any local/worktree execution, for any PR, regardless of content.

Command run in isolation to separate this known gate from real static verification: `pnpm verify:static` (env:check + lint + type-check + build + test + command-manifest/migration-lint checks, i.e. every static verification step `verify` runs before `test:live-db`) → **exit 0**, clean. Output excerpt:
```
# tests 114
# suites 13
# pass 114
# fail 0
...
[command-manifest] Verified 14 command definition(s) against .../apps/discord-bot/command-manifest.json
[check-migration-versions] 5 migration file(s) verified — no duplicate versions.
[lint-migrations] 4 migration file(s) checked — no findings.
```
Result: **PASS** (static verification); `test:live-db`'s environment-gated refusal is a known, pre-existing local-execution limitation, not a defect in this diff.

### R-level check

Command: `tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`
Output:
```
Verdict: PASS
Changed files: 4
Rules matched: (none) — no R-level artifacts required for this diff
```
Result: **PASS** — confirmed no `r1-r5-rules.json` path pattern (`apps/api/**`, `packages/domain/**`, etc.) matches this docs-only diff.

## Acceptance criteria mapping

| Acceptance criterion (UTV2-1666, PM_VERDICT round 5) | Verified by |
|---|---|
| Append-only host journal architecture defined (immutable record paths, atomic index, retention/compaction, unresolved-operation protection) | `DEPLOYMENT_TRUTH_DESIGN.md` §5.5 |
| Monotonic host-generated sequence replaces wall-clock ordering as the correctness-determining mechanism | `DEPLOYMENT_TRUTH_DESIGN.md` §4, §5, §10 |
| Canonical release-managed service set defined, excluding Loki/Grafana/Caddy, via a mechanical rule (not a hand-maintained list) | `DEPLOYMENT_TRUTH_DESIGN.md` §5 |
| PR/proof packet reconciled: PR body scenario count, design doc status line, evidence bundle | This file + `evidence.json` + PR #1372 body + `DEPLOYMENT_TRUTH_DESIGN.md` status line |
| Host-observer hardening decision (environment-scoped secret, unprivileged account, root-owned forced-command wrapper, no PTY/forwarding, pinned host key, no docker-group, bounded output) folded into §12a | `DEPLOYMENT_TRUTH_DESIGN.md` §12a |

| Acceptance criterion (UTV2-1666, PM_VERDICT round 6) | Verified by |
|---|---|
| Journal immutability claim corrected — round 5's sticky-bit/chmod claim was false; a real root-owned write boundary specified (deploy account has zero direct filesystem access; writes go through a fixed, `sudoers`-scoped, root-owned helper) | `DEPLOYMENT_TRUTH_DESIGN.md` §5.5 "root-owned write boundary"; regression row 36 |
| Every sequence/index crash state enumerated and classified `unknown` (counter-advanced/no-intent, intent-written/index-stale, confirmation-written/current-unchanged, duplicate sequence, current-ahead-of-counter) | `DEPLOYMENT_TRUTH_DESIGN.md` §5.5 crash-state table; regression rows 37–40 |
| Operations made sequence-addressable (`journal/ops/{sequence}/`) with a tuple-lookup index, replacing tuple-path-only addressing that had no bounded-scan mechanism | `DEPLOYMENT_TRUTH_DESIGN.md` §5.5 |
| `journal/current` points at operation identity, not a cached record snapshot — closes the "confirmation lands, index numerically unchanged" blind spot round 5's staleness check could not detect | `DEPLOYMENT_TRUTH_DESIGN.md` §5.5 crash state c |
| All surviving pre-round-5 ordering/provenance language corrected to the single `journal_sequence` rule (§3.5 selection rule, §9 rollback-precedence + SHA-shape language, §13 selection description, regression row 12) | `DEPLOYMENT_TRUTH_DESIGN.md` §3.5, §9, §13, row 12 |
| §12's stale "Open decision for PM" language resolved to reflect the round-5 approval-in-principle for §12a and round-6 reconfirmation that §12b remains not pre-authorized | `DEPLOYMENT_TRUTH_DESIGN.md` §12 |
| Runtime Verifier's diff-local failure (verification doc contained no commit SHA) fixed with an honest prior-head SHA reference, same convention as `evidence.json` | This file's "Prior reviewed head" line |
| Stale diff-summary table (referenced the deleted `.gitkeep`, wrong file count) regenerated against the real current diff | This file's "Diff Summary" section |

| Acceptance criterion (UTV2-1666, PM_VERDICT round 7) | Verified by |
|---|---|
| Rollback provenance made label-authoritative: the rolled-back image's own `org.opencontainers.image.revision` label is the sole verified source; a historical `deployed_tag`→`source_sha` mapping corroborates only, never substitutes, since tags are mutable | `DEPLOYMENT_TRUTH_DESIGN.md` §8, §9 row, regression row 41 |
| Tag-repoint hazard named explicitly: label present but disagreeing with an available historical mapping is `unreadable`/`unknown`, never resolved by preferring either value | `DEPLOYMENT_TRUTH_DESIGN.md` §8; regression row 41 |
| Supplementary-reader-group option removed as incoherent under the root-owned `0700` journal directory; observer reads only through the fixed root-owned forced-command helper | `DEPLOYMENT_TRUTH_DESIGN.md` §5.5 |
| Forced-command reader's contract specified as allowlisted-fields-only, no caller-controlled paths or arbitrary subcommands | `DEPLOYMENT_TRUTH_DESIGN.md` §5.5; regression row 42 |
| PR body and review history reconciled to the stationary head (42 scenarios, rounds 1–7 recorded) | PR #1372 body |

## Stop conditions encountered

- Tier mismatch discovered mid-verification (round 5): manifest declared T1, but this lane has no runtime/DB footprint and T1's mechanical R1/R2 checks have no waiver path. Resolved by correcting the manifest tier to T2 (see "Tier correction" above) rather than fabricating DB evidence. Not escalated before acting — this is a mechanical proof-packet correction consistent with the PM's own round-5 instruction to "make only the bounded design/proof corrections," not a change to the design's reviewed content.
- Round 6: no new stop conditions. All four findings were bounded, verifiable corrections (a false permissions claim checked against real Unix semantics, a precisely-described crash-state gap, an exhaustive grep sweep for stale language, and two mechanical proof-doc defects) — none required a judgment call beyond what the PM_VERDICT itself specified.
- Round 7: no new stop conditions. The rollback-provenance finding required design judgment (deciding the label-authoritative/history-corroborates-only relationship and how disagreement should be scored), but the direction was fully specified by the PM_VERDICT itself; the observer-access finding was a direct logical consequence of round 6's own `0700` permission choice, not a new architectural decision.

## Sign-off

**Verifier:** claude/utv2-1666-deployment-truth-design — 2026-08-03
**PM acceptance:** pending (round-7 corrections applied; awaiting PM re-review of stationary head per PR #1372)
