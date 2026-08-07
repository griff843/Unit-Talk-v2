# UTV2-1567 — Diff Summary

MERGE_SHA: 116f3f3ff1b49ecf7b5a819bf42a651bc31c59d9

The merge commit of PR #1286, bound in a separate post-merge commit.

**Correcting the claim that stood here.** The anchor was added pre-merge for
CEP-E5 (UTV2-1649), with a note asserting that `post-merge-lane-close.yml`
"rewrites this line with the real merge commit after the PR lands." **That was
wrong, and this lane proved it wrong on itself.** The automated rebind
(`rebindRepairedLaneProof`) writes only `evidence.json` and `verification.md`;
`scripts/ops/proof-generate.ts` (~line 158) states that leaving
`diff-summary.md` untouched is "the safest thing," because regenerating it
would overwrite authored content.

So closeout failed after merge on exactly this file:

```text
[FAIL] P3  proof files missing merge SHA reference: docs/06_status/proof/UTV2-1567/diff-summary.md
[FAIL] C4  proof artifacts missing required SHA binding (116f3f3ff1b49ecf7b5a819bf42a651bc31c59d9)
```

`P3` requires the literal merge SHA in **every** path listed in the manifest's
`expected_proof_paths` (`truth-check-lib.ts` ~line 675), and this lane lists
`diff-summary.md`. The gap between the two sets has always been closed by hand —
e.g. `chore(proof): UTV2-1209 bind merge SHA 2a7e535c to proof bundle and lane
manifest`, and the same for UTV2-1225 and UTV2-1221. It was never automated and
never written down. UTV2-1503 closed cleanly only because its manifest happened
to declare `evidence.json` instead of `diff-summary.md`; its own
`diff-summary.md` still reads `MERGE_SHA: pending` on `main` today, inside a
lane carrying a `pass` receipt.

**The defect, stated generally: the validator population is not the binder
population.** Truth-check validates every artifact in `expected_proof_paths`;
the binder owns a fixed subset. Any artifact in the difference must be bound by
a human or the lane cannot close — silently, and only after merge. Recorded as
durable follow-up under UTV2-1673 (PM decision 2026-08-07): every proof artifact
truth-check requires must be owned by the automated binding mechanism.

This commit is that manual binding, performed once, under explicit PM
authorization, and scoped to this one line plus this explanation. It is not a
repair loop: the expected SHA is already fixed at `pr.mergeSha` of the merged
PR #1286, so no later commit can move it.

Issue: UTV2-1567
Tier: T2
Lane type: governance
Branch: `claude/utv2-1567-workflow-dispatch-sha-fix`

## Problem

`post-merge-lane-close.yml`'s "Bind proof artifacts to merge SHA" step set `MERGE_SHA: ${{ github.sha }}` unconditionally. That's correct for the `push` trigger (`github.sha` genuinely is the new merge commit there), but wrong for a `workflow_dispatch` manual replay: `github.sha` then resolves to whatever commit is checked out at dispatch time (today's `main` HEAD), not the historical merge SHA of the target issue's actual PR.

Discovered while reconciling ghost lane manifests (UTV2-1424/1446/1546/1563/1564/1565): four `workflow_dispatch` replay attempts against already-merged lanes all failed `stale_proof` (P3/C4) because proof got rebound to today's HEAD instead of each issue's real merge commit.

## Outcome: honest partial — the capability is NOT delivered

**PM decision 2026-08-04; residual capability tracked as UTV2-1673.** While this
PR sat open, `main` closed the same defect more conservatively (UTV2-1589,
PR #1308, merged 2026-07-25) by restricting the *only consumer* of this lane's
`resolve_sha` output to `github.event_name == 'push'`. This lane's
`workflow_dispatch` branch is therefore correct code that cannot be reached,
and `push` behavior is unchanged. Full rationale in `verification.md`'s SCOPE
LIMITATION section. Do not record UTV2-1567's acceptance criteria as met.

## Merge resolution (2026-08-07, PM-authorized)

True merge of `origin/main` into this branch (no rebase), per PM directive.
Exactly one conflict — `.github/workflows/post-merge-lane-close.yml`, this
PR's own file. Resolved by taking `main`'s content entire (preserving
UTV2-1586's `pr` dispatch input, UTV2-1589's push-only restriction and runtime
guard, and UTV2-1590's scope guard) and re-applying this lane's two deltas on
top: the `resolve_sha` step, and the bind step's `MERGE_SHA` source. All five
lane/proof/sync artifacts verified byte-identical across the merge.

## Fix

- `.github/workflows/post-merge-lane-close.yml`: new "Resolve merge SHA" step. For `workflow_dispatch`, resolves the real merge SHA via `gh pr view <manifest.pr_url> --json mergeCommit` instead of `github.sha`; falls back to `github.sha` if the lookup fails for any reason. For `push`, behavior is unchanged (`github.sha` is correct there). The "Bind proof artifacts" step now consumes `steps.resolve_sha.outputs.merge_sha` instead of `github.sha` directly.
No test file is added by this PR. A `scripts/ops/post-merge-lane-close-workflow.test.ts` carrying three static assertions was written and then **removed** on PM decision (2026-08-07); the coverage is reassigned to UTV2-1673. See `verification.md` § "Regression coverage moved out of this lane" for the assertions, the reason, and the negative-control result that must travel with them.

**Why no test ships here.** `pnpm test` composes explicit test lists, not globs, so a new test file is unreachable until named in `package.json`'s `test:ops` — and `verify` fails closed on exactly that:

```text
[FAIL] WIRING_TEST_UNWIRED_NEW scripts/ops/post-merge-lane-close-workflow.test.ts
```

`package.json` is absent from UTV2-1567's `file_scope_lock`, and `resolveTrustedManifests` locks a branch-introduced manifest's declared scope to **the first commit that added it** (`13032fa0`, the lane-start declaration) precisely so a later commit cannot widen its own scope to bless an out-of-scope edit. The reviewed-baseline alternative lives in `docs/05_operations/executable-wiring-baseline.json` — also out of scope, and capped by its own `max_entries`. Both remedies therefore required a PM scope override.

**PM declined the override and directed removal instead (2026-08-07):** the bootstrap path exists to remove future bootstrap needs, so spending one to land a test that still would not execute contradicts the objective. UTV2-1673 must touch this same workflow anyway and can declare `package.json` in scope from lane-start, so the assertions land there wired rather than here inert.

*An earlier revision of this note blamed active locks held by UTV2-1550 and UTV2-1554. That was stale, and was re-checked on 2026-08-07: UTV2-1554 is `done`, and `scripts/ci/file-scope-guard.ts` (line ~33) explicitly holds that `"merged" alone, with no live continuation, must never count as active`, so UTV2-1550's `merged` manifest holds no lock either. Neither lane blocks this.*

### The generalized finding

**Controls must be validated by execution path, not artifact presence alone.**

Three separate instances surfaced in this one lane, all the same shape — an artifact that looks like enforcement but never executes against the condition it names:

1. **The unwired test.** Present, green when run by hand, and reachable by nothing in CI.
2. **The push-only guard.** Asserted `match(/'push'/)`, which still matches inside a widened `('push' || 'workflow_dispatch')` disjunction — it passed while the gate it guarded was open. Caught only by deliberately widening the gate and confirming the test failed.
3. **UTV2-1589's own tests.** They locate their target via unanchored `workflow.indexOf(<step name>)`; a comment mentioning that name above the step captured the scan, so all three asserted against the wrong step and reported a safety regression that did not exist.

Presence, and even a green run, are not evidence a control is wired to what it claims to check. The test is: can this control be made to fail on the condition it names? If not, it is documentation.

No runtime, domain, or DB code touched.

## PM verdict fixes (2026-07-21, this revision)

- Populated `docs/06_status/lanes/UTV2-1567.json`'s `pr_url` (previously null), which was blocking the post-merge auto-close repair path from binding proof or closing the lane.
- Added a real `pnpm test:db` run to `verification.md` to satisfy Proof Auditor Gate's blanket requirement (applies to every touched proof directory regardless of tier).
- Removed the `package.json` edit rather than force a cross-lane conflict on that same line. *(That was the reasoning at the time. The lock rationale was later found stale — see "Why no test ships here" above; the edit is out of this lane's declared scope regardless, which is the durable reason.)*

## PM verdict fix (2026-07-21, this revision — bind-cycle)

Repeated PM verdicts (12:47/13:08/15:46) said the manifest's commit binding lagged "the current head" each time a new commit was pushed. This is structurally impossible to satisfy by writing a live head SHA into the manifest: a commit cannot embed its own hash, so any push that updates `commit_sha` to match itself immediately creates a new head the field no longer matches — an infinite regress.

Investigation of the actual mechanics (read directly, not assumed):
- `.github/workflows/return-review-packet.yml` never reads the manifest's `commit_sha`. It passes `--head "${{ github.event.pull_request.head.sha }}"` — the live PR head from the event payload — directly to `scripts/ops/pr-review-packet.ts`.
- `scripts/ops/pr-review-packet.ts`'s six checks (`scope`, `test_wiring`, `dropped_tests`, `sync_metadata`, `r_level`, `proof`) never reference `manifest.commit_sha` either.
- `docs/05_operations/LANE_MANIFEST_SPEC.md` §2/§4.2 documents `commit_sha` as **"populated at merge"** — i.e. it is not meant to track the live pre-merge head at all.
- Confirmed by convention: `docs/06_status/lanes/UTV2-1554.json` (status `in_review`, still open) carries a `commit_sha` that does not match its PR's live head either, with no CI effect.

Fix: set `commit_sha` back to `null` in this manifest (its pre-merge default per spec) instead of chasing a self-referencing value, and documented why in the manifest's own `notes` field. This is the terminal fix — no further push needs to "catch up" the field, because the field intentionally does not track the live head pre-merge.

The mechanical Return Review Packet failure at that time was unrelated to head-binding: it was the `test_wiring` check on the then-present test file. **Resolved as of 2026-08-07 by removing that file** (see "Why no test ships here"), so `test_wiring` no longer has an unwired target. Confirmed via `gh api repos/griff843/Unit-Talk-v2/branches/main/protection`: the only branch-protection-required status checks are `verify`, `Executor Result Validation`, `Merge Gate`, and `P0 Protocol`. `Return Review Packet` and `Readiness Regression Gate` are advisory/non-blocking. The Readiness gate is independently red for a parked-production reason unrelated to this lane.
