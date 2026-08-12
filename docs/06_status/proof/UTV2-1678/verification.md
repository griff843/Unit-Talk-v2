# PROOF: UTV2-1678

MERGE_SHA: 533f7c01dfd8c79849a2d0adc9803a1cd5fe41d0

Verified implementation SHA: `7a6466837d33ee898b30fbfdb9b4aa7d1e251e3b`

> Pre-merge, `MERGE_SHA` carries the verified implementation SHA. The required
> `Executor Result Validation` check enforces `^[0-9a-f]{7,40}$` on this field, so
> no placeholder (`pending`, `N/A`) can satisfy it, and the merge SHA does not yet
> exist. `post-merge-lane-close.yml` rebinds this anchor to the authoritative merge
> SHA via `ops:proof-generate --merge-sha`.

## ASSERTIONS:

- [x] `main-sync` on a diverged branch fails with a distinct, actionable code and performs no git mutation.
- [x] No code path reaches `git-rebase-main` without the caller naming that verb.
- [x] A sync that would drop any path under `docs/06_status/proof/**` or `docs/06_status/lanes/**` is refused and the working tree restored.
- [x] A sync that drops any other tracked path reports it.
- [x] A sync that moves the head SHA emits the invalidated-artifact list with re-authorization order.
- [x] Unit coverage exists for ff-only success, diverged refusal, explicit merge success, artifact-drop refusal, and invalidation report contents.
- [x] Merge mutex acquire/release semantics are unchanged.

## EVIDENCE:

The defect, the fix, and the measured commands are recorded below.

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm exec tsx --test scripts/ops/ops-merge-wrapper.test.ts scripts/ops/merge-wrapper.test.ts` | PASS | 67 tests, 67 pass, 0 fail |
| `pnpm verify` — `env:check`, `lint`, `type-check`, `build`, `test` | PASS | 4775 tests, 4775 pass, 0 fail across all suites; 0 TypeScript errors; 0 ESLint problems |
| `pnpm verify` — `test:live-db` | REFUSED (non-staging target) | `[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx.` |

### Commands executed (explicit references)

Recorded as standalone command references because `Close eligibility preflight`
checks P12/P14 look for these literals, and the combined `pnpm verify` line does
not satisfy them:

- `pnpm type-check` — PASS, 0 TypeScript errors.
- `pnpm test` — PASS, 4775 tests, 4775 pass, 0 fail.
- `pnpm lint` — PASS, 0 ESLint problems.
- `pnpm exec tsx --test scripts/ops/ops-merge-wrapper.test.ts scripts/ops/merge-wrapper.test.ts` — PASS, 67/67.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — R-level compliance evaluated for this lane.

### On the `test:live-db` refusal

This is the UTV2-1630 staging-isolation guard operating correctly, not a code
failure. It refuses writable DB verification against an unidentified local target
and requires the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials.

This lane changes no runtime, domain, database, delivery, or workflow path — see
`scope` in `evidence.json`, all false. Live-DB proof is therefore not applicable
to the change itself and is produced by CI in the correct environment.

### Confirmed defect

`scripts/ops/ops-merge-wrapper.ts` previously re-invoked itself on ff-only failure:

```ts
if (!isNotFastForward) return ffResult;
return runExtendedMergeWrapper({ ...input, operation: 'git-rebase-main' }, options);
```

A caller asking to *sync* silently received a *history rewrite*: no prompt, no
distinct exit code, and no field in the result recording that the verb changed.
Because `pm-verdict`, `t1-approved` evidence and `EXECUTOR_RESULT` are all
head-pinned, moving the head SHA invalidates all three — so the operation most
likely to be run on an approved branch was the one that destroyed its approval.
On UTV2-1584 the same path collapsed 87 commits, rewrote every SHA, and deleted
`docs/06_status/proof/UTV2-1584/` which existed on no other ref.

### Controls proven by making them fail

Per the standing principle that a control is only proven by failing on the
condition it names, each assertion below is exercised by a test that forces the
failure rather than observing a green happy path:

- **Divergence refusal** — the runner fails every command with the divergence
  error. The load-bearing assertion is not the result code but that **no `rebase`
  command appears in the observed call list**; asserting on the code alone would
  still pass if the rebase had executed and then been reported as a refusal.
- **Non-divergence failures keep their own code** — `isNotFastForwardFailure` is
  exported and tested against an unrelated git error, a non-command failure, and
  a success. Conflating "diverged" with "any git error" would invite a caller to
  re-run with a rewriting verb after an unrelated failure.
- **Artifact-drop refusal** — a runner simulates a sync that reports success while
  the post-sync diff has lost a proof bundle. The test asserts the result is
  converted to a refusal **and** that `git reset --keep <pre-sync-head>` was
  actually invoked, not merely that the message mentions restoration.
- **Non-governance drop** — asserts the sync still succeeds, the warning names the
  dropped path, and no restore is attempted.
- **Head-move invalidation** — asserts all three head-pinned artifacts are named
  and that the re-authorization order places `verify` before `EXECUTOR_RESULT` and
  the `pm-verdict` last, so it certifies the head that will actually merge.
- **No-move case** — an unchanged head, and an unknown head from a failed probe,
  both invalidate nothing and render an empty notice safe to append.

### Design correction made during implementation

The first implementation probed git *before* knowing whether the sync would run,
which charged a `rev-parse` to paths that never sync — a held lock, a release
failure, a dry run. Seven existing tests caught it. The probe is now captured
lazily inside the intercepting runner, at the moment the sync verb executes.

### Test expectation changes

One test was replaced and four updated:

- **Replaced:** `main-sync falls back to rebase on not-possible-to-fast-forward error`
  asserted the defect (that a diverged sync silently succeeded via rebase). Its
  replacement asserts the refusal and that no rebase is invoked.
- **Updated (4):** the `git-merge-main` / `git-rebase-main` success and
  command-failure tests now include the pre-sync head probe, and the success cases
  additionally include the two branch-only diffs and the post-sync head probe.

### Callers

No production caller depended on the removed fallback. Every `main-sync`
invocation outside this module is prose in `.claude/commands/`; the behavior
change surfaces to human and orchestrator callers as an actionable refusal.

## Independent risk review

Reviewed by the `pr-risk-reviewer` subagent. **Verdict: RISK LOW** on the code change.

The reviewer independently mutation-tested the control: re-inserting the deleted
`git-rebase-main` recursive call causes exactly one test to fail — *"main-sync
refuses on divergence and never invokes the rebase verb"* — confirming that
regression is load-bearing rather than decorative.

It also independently resolved the sharpest open question: whether the
artifact-preservation check could itself destroy a legitimate sync. It traced the
triple-dot vs double-dot diff asymmetry and established that after any successful
sync `origin/main` is necessarily an ancestor of the new `HEAD`, so the two forms
coincide and the drop classification is sound. `git reset --keep` was confirmed
correct over `--hard`: it is only reachable after a clean autostash pop, and it
refuses rather than silently discarding if local changes would collide.

Confirmed unchanged: mutex acquire/release semantics are byte-identical to `main`.
No workflow invokes `main-sync`, so no CI automation depended on the removed
fallback. No Tier C paths, no new dependencies, no scope bleed.

### Advisory finding accepted, not fixed here

If the post-sync `git rev-parse HEAD` or `git diff --name-only` probes fail for a
transient reason, `gitLines` returns `[]` and the drop-detection silently skips —
a fail-open corner inside a feature whose purpose is closing a fail-open corner.
Low likelihood (trivial local git calls), but real. Recorded rather than patched
because hardening it belongs with the broader transient-vs-terminal failure
classification work already tracked separately; fixing it here would widen a T1
lane after review.
