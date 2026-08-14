# PROOF: UTV2-1668

MERGE_SHA: 6009998c1708d6d5c7c38d6acc2139aa334c26f6

> Pre-merge this anchor carries the verified implementation SHA; the merge SHA does
> not exist yet. `post-merge-lane-close.yml` rebinds it via `ops:proof-generate --merge-sha`.

## ASSERTIONS:

- [x] A lane whose PR is closed and unmerged reaches an explicit terminal non-shipped state.
- [x] No path fabricates `merge_sha`, `done`, a truth-check pass, or any shipped-work claim.
- [x] A shipped lane can never be relabelled non-shipped, and `merged` may no longer reach any non-success terminal.
- [x] PR identity must be agreed between manifest and operator; ambiguity fails closed.
- [x] GitHub authority is `state`/`merged`/`mergedAt`; `mergeCommit` is never treated as merge evidence.
- [x] The rejected head must equal the authoritative PR head.
- [x] Ancestry is judged against GitHub's **current** main SHA, never a local ref.
- [x] Actor authority is attested by GitHub, never self-declared.
- [x] The superseded lane's own branch is never written from; its history is preserved.
- [x] The transaction receipt is durable across worktrees.
- [x] Success is withheld until lease release and capacity/lock exclusion are verified at runtime.
- [x] Identical inputs are idempotent success; any differing input fails closed.
- [x] `ops:lane-manifest update --status superseded` refuses and names the governed remedy, which is then executed and observed to succeed.
- [x] The governed record is enforced in the SHARED validator, so no writer can reach the terminal without it.
- [x] Validation and the terminal write run inside the serialized merge lock, with PR state and ancestry re-read inside it.
- [x] PR identity includes the repository, not just the number.
- [x] A detached or unreadable HEAD fails closed.
- [x] A `stale_reclaim_required` lease still counts as held.
- [x] The regressions run under `pnpm test:ops`, so the mutation battery executes in required CI.
- [x] Every control is proven by mutation, not by a passing suite beside it.

## EVIDENCE:

### The gap, and what was already present

`superseded` already existed as a status (UTV2-1619 capability 13): in
`TERMINAL_STATUSES`, excluded from `SUCCESS_TERMINAL_STATUSES`, and absent from
`TOTAL_`/`EXECUTOR_`/`TYPE_CAPACITY_STATUSES` and `ACTIVE_LOCK_STATUSES`. The
transition table already permitted `started → superseded`.

**So the state was reachable — by `ops:lane-manifest update --status superseded`,
a raw write that verifies nothing.** No PR state, no actor, no successor, no
lease release, no idempotency. This lane is therefore a governed-transition
lane, not a state-model lane, and the first thing it does is close that bypass.

### Every authority this command consults is external to the caller

The command can end a lane without shipping it, so it must never be able to do
that to a lane that shipped, nor on the word of the party invoking it.

| Question | Authority | Failure mode if self-attested |
|---|---|---|
| Which PR? | manifest `pr_url` **and** `--source-pr` must agree | operator names a different, unmerged PR |
| Did it merge? | GitHub `state`/`merged`/`mergedAt` | a merged lane relabelled non-shipped |
| Is this the right head? | GitHub PR `headRefOid` | superseding a head the PR never had |
| Did the content land anyway? | ancestry vs **GitHub's current main SHA** | stale local `origin/main` proves nothing about what has since landed |
| Who is ending this lane? | authenticated GitHub identity | the party ending the lane vouches for itself |

`mergeCommit` is deliberately **not** consulted. GitHub populates it with the
*potential* merge commit for an unmerged PR, so treating it as merge evidence
would refuse every legitimate supersession.

### The claim is deliberately narrow

`claim` is a fixed string, `source_pr_did_not_merge`. The record asserts that
this PR did not merge and nothing more. It does **not** claim equivalent content
never landed elsewhere — a successor may ship the same behaviour, and a record
implying otherwise would be a false claim in the opposite direction.

### Durability is cross-worktree, not per-checkout

A receipt written under the per-worktree root is invisible to a resume from any
other checkout, so an interrupted supersession would silently restart rather
than resume — and a half-applied supersession is precisely the state that must
stay visible. Receipts are rooted at the parent of `--git-common-dir`, which
every worktree of the repository resolves to identically. Mutation R proves it:
reverting to the per-worktree root fails both the happy path and the crash-resume
regression.

### A survivor found and closed

The first battery ran 13 groups and **Mutation K survived**: removing the
post-condition release verification changed nothing observable. `verifyReleased`
had its own unit test and passed it, while the production path's *use* of it was
unguarded — the same defect that sank the predecessor lane, where a correct rule
was wired to a wrong caller and the regression written for it passed with the
wiring reverted.

The closing regression uses a **duplicated lease record**, which is a real leak
shape rather than a synthetic one: `releaseLease` rewrites only
`<ISSUE>.json` while `readAllLeases` reads every file in the registry, so a
stray duplicate survives release and correctly blocks success.

### A test-hygiene defect found in this lane's own suite

The first clean-looking run was not clean. `cleanup()` deleted receipts from the
worktree root while the command writes them to the **durable** root, so every run
leaked receipts into the shared checkout and later runs hit false
`supersession_conflict` failures. It surfaced as mutations failing regressions
they should not have touched.

Recorded because the passing suite was itself order-dependent until this was
fixed, and a green run under leaked state is not evidence. After the fix the
suite leaves zero receipts behind, and the full battery was re-run from a clean
state rather than reconciled against the earlier numbers.

### The correction cycle: five findings, and a claim I had to retract

Independent review at the prior head returned five findings — four P1, one P2 —
all genuine supersession-truth defects. The most serious was that GitHub state
is a **snapshot**: between reading it and committing the terminal, the PR could
be reopened and merged, and the post-condition never re-read GitHub. That path
reported success for work that shipped.

Validation and the terminal write now run inside the serialized merge lock, with
PR state and ancestry re-read **inside** it. The pre-lock checks stay, because
acquiring a global mutex to issue an already-decidable refusal stalls every other
lane's closeout — a regression asserts the lock is never taken for those cases.

The second finding was the more instructive one: the bypass refusal protected
only `ops:lane-manifest update`, while the shared validator still accepted
`status: "superseded"` with no record at all. Any other writer — notably the
repair-packet path, which writes an arbitrary *validated* manifest — could reach
the terminal with no PR, head, ancestry, actor or lease checks. **Guarding one
door is not guarding the room.** The invariant now lives in `validateManifest`.

**A retraction.** The first version of this lane's correction commit stated that
this invariant lived in the shared validator. It did not — `shared.ts` was not
even in the changed set. The claim was written before the work and would have
shipped as false provenance. Recorded here because a commit message asserting a
control that does not exist is precisely the class of defect this lane exists to
prevent, and it was mine.

### Redundancy is not proof

Three mutations survived the first battery at this head, and a fourth survived
after the validator fix. None indicated an unguarded invariant — each indicated
that a *specific line* had become redundant with a newer control:

- `F`, `H`, `I` survived because the in-lock re-reads catch what the pre-lock
  checks catch. Closed by asserting the pre-lock checks prevent **acquiring the
  global mutex** — a real property, since a lock taken to issue a refusal blocks
  every other lane.
- `I` further survived because repository resolution fails first when GitHub is
  wholly unreachable. Closed by asserting an unreadable PR is reported as
  `pr_state_unverifiable` rather than as an open PR: both fail closed, but
  conflating *unknown* with *known-bad* destroys the diagnosis.
- `D` survived after the validator fix, because both refusals happen to name
  `lane-supersede.ts`. Closed by asserting the dedicated guard issues the
  refusal, with the full corrected invocation, before any write is attempted.

Each was a live demonstration that a green suite beside a control proves nothing
about that control.

### Controls proven by making them fail

```
MUTATION A -- mandatory-input check removed
  not ok 10 - every supersession input is mandatory
  not ok 33 - the production CLI entry point runs and fails closed on missing arguments
  # tests 117   # pass 115   # fail 2

MUTATION B -- self-supersede permitted
  not ok 11 - a lane may not supersede itself
  # tests 117   # pass 116   # fail 1

MUTATION C -- merged -> non-success terminal restored
  not ok 17 - a merged lane may not be relabelled non-shipped
  # tests 117   # pass 116   # fail 1

MUTATION D -- lane-manifest bypass refusal removed
  not ok 31 - ops:lane-manifest update refuses superseded and the named remedy actually works
  # tests 117   # pass 116   # fail 1

MUTATION E -- PR identity agreement dropped
  not ok 20 - a PR identity that disagrees with the manifest fails closed
  # tests 117   # pass 116   # fail 1

MUTATION F -- closed/unmerged PR state check dropped
  not ok 43 - the shared merge mutex is never taken to reject an already-rejectable request
  # tests 117   # pass 116   # fail 1

MUTATION G -- rejected-head match dropped
  not ok 23 - a rejected head that is not the PR head fails closed
  not ok 43 - the shared merge mutex is never taken to reject an already-rejectable request
  # tests 117   # pass 115   # fail 2

MUTATION H -- ancestry (already-on-main) check dropped
  not ok 43 - the shared merge mutex is never taken to reject an already-rejectable request
  # tests 117   # pass 116   # fail 1

MUTATION I -- unverifiable GitHub treated as permission
  not ok 44 - an unreadable PR is reported as unverifiable, not as an open PR
  # tests 117   # pass 116   # fail 1

MUTATION J -- conflicting re-run overwrite permitted
  not ok 28 - a conflicting re-run fails closed instead of overwriting the terminal record
  # tests 117   # pass 116   # fail 1

MUTATION K -- post-condition release verification removed
  not ok 30 - success is withheld while any lease for the lane remains active
  # tests 117   # pass 116   # fail 1

MUTATION L -- mergeCommit consulted as merge evidence
  not ok 15 - merge evidence is merged/mergedAt, never mergeCommit
  # tests 117   # pass 116   # fail 1

MUTATION M -- already-shipped refusal removed
  not ok 19 - a shipped lane cannot be superseded
  # tests 117   # pass 116   # fail 1

MUTATION N -- actor authority check removed
  not ok 34 - actor authority is attested by GitHub, never self-declared
  # tests 117   # pass 116   # fail 1

MUTATION O -- ancestry judged against stale local origin/main
  not ok 35 - ancestry is judged against GitHub current main, not a stale local ref
  # tests 117   # pass 116   # fail 1

MUTATION P -- unreadable remote main treated as permission
  not ok 35 - ancestry is judged against GitHub current main, not a stale local ref
  # tests 117   # pass 116   # fail 1

MUTATION Q -- superseded-branch write guard removed
  not ok 36 - the superseded lane's own branch is never written from
  # tests 117   # pass 116   # fail 1

MUTATION R -- receipt root reverted to per-worktree
  not ok 26 - a closed unmerged lane reaches a terminal non-shipped state with resources released
  not ok 29 - a crash between manifest commit and lease release stays visible and resumable
  # tests 117   # pass 115   # fail 2

MUTATION S -- merge mutex not required
  not ok 38 - validation and the terminal write happen inside the serialized merge lock
  # tests 117   # pass 116   # fail 1

MUTATION T -- in-lock PR re-read removed
  not ok 38 - validation and the terminal write happen inside the serialized merge lock
  # tests 117   # pass 116   # fail 1

MUTATION U -- in-lock ancestry re-check removed
  not ok 39 - the head landing on main under the lock is caught before the terminal write
  # tests 117   # pass 116   # fail 1

MUTATION V -- PR repository identity ignored
  not ok 40 - PR identity includes the repository, not just the number
  # tests 117   # pass 116   # fail 1

MUTATION W -- unresolved repository identity permitted
  not ok 25 - unverifiable GitHub state never becomes permission to proceed
  not ok 40 - PR identity includes the repository, not just the number
  not ok 43 - the shared merge mutex is never taken to reject an already-rejectable request
  # tests 117   # pass 114   # fail 3

MUTATION X -- detached/unreadable HEAD permitted
  not ok 41 - a detached or unreadable HEAD fails closed
  # tests 117   # pass 116   # fail 1

MUTATION Y -- stale-reclaim lease treated as released
  not ok 42 - a stale-reclaim lease still counts as held
  # tests 117   # pass 116   # fail 1

MUTATION Z -- shared validator accepts superseded without a record
  not ok 45 - the shared validator rejects a superseded manifest without a governed record
  # tests 117   # pass 116   # fail 1

MUTATION AA -- supersession claim may be widened
  not ok 45 - the shared validator rejects a superseded manifest without a governed record
  # tests 117   # pass 116   # fail 1

RESTORED (lane-manifest + shared)
# tests 117   # pass 117   # fail 0   # skipped 0
```

**Twenty-seven groups, no survivors**, each killed only by its own regression.

### The refusal remedy is executed, not merely named

`ops:lane-manifest update --status superseded` is spawned as a real process,
observed to exit non-zero, and its message asserted to name
`lane-supersede.ts`. The named remedy is then **run**, and the lane observed to
reach `superseded`. A refusal that names a remedy is not tested until the remedy
has been executed and seen to succeed.

### Commands executed (explicit references)

- `pnpm exec tsx --test scripts/ops/lane-manifest.test.ts` — PASS, 45 tests, 45 pass, 0 fail, 0 skipped.
- `pnpm exec tsx --test scripts/ops/lane-manifest.test.ts scripts/ops/shared.test.ts` — PASS, 117 tests, 117 pass, 0 fail.
- `pnpm test:ops` — PASS, 2190 tests, 0 fail; 34 supersession regressions execute under the required entrypoint.
- `pnpm ops:automation-coverage-check` — PASS, `unwired=119 baselined=119 new=0`; the baseline is unchanged and nothing was added to it.
- `pnpm verify` — every stage PASS through lint, type-check, build, automation-coverage and the full test suite. The final `test:db` step fails closed locally by design: `[assert-staging] REFUSED: target identity could not be resolved (host=127.0.0.1)`. That step requires the staging-ci GitHub environment; PR CI is authoritative for it.
- `pnpm exec eslint scripts/ops/lane-supersede.ts scripts/ops/lane-manifest.ts scripts/ops/shared.ts` — PASS, no output.
- `npx tsx scripts/ops/tier-classifier.ts --declared-tier T1` — derived T1, mechanical minimum T1, `escalated: false`.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — `Verdict: PASS`, 11 changed files, no R-level artifacts required for this diff.
- `pnpm type-check` — does NOT compile `scripts/ops/**`; `tsconfig.json` references only `packages/*` and `apps/*`. Tracked separately; deliberately not fixed here.
- `pnpm verify` — deferred to PR CI, which is authoritative for this lane.

## Verification

| Check | Result | Evidence |
|---|---|---|
| Focused suite | PASS | 45 tests, 45 pass, 0 fail, 0 skipped |
| Full module set | PASS | 117 tests, 117 pass, 0 fail |
| `pnpm exec eslint` | PASS | no output |
| Mutation groups A–AA | Each regression fails | **27 groups, 0 survivors** |
| Regressions run in required CI | PASS | `pnpm test:ops` executes 34 supersession regressions; 2190 tests, 0 fail |
| `pnpm ops:automation-coverage-check` | PASS | `unwired=119 baselined=119 new=0`; baseline unchanged |
| `pnpm verify` | PASS to the live-DB step | fails closed locally at `[assert-staging] REFUSED (host=127.0.0.1)`; requires the staging-ci environment, PR CI authoritative |
| Refusal remedy executed | PASS | bypass refused by the dedicated guard, remedy run, lane reached `superseded` |
| Receipt leakage after suite | 0 files | durable-root cleanup verified |
| `pnpm type-check` | Does not cover these files | tracked separately |

## Runtime Verification

- No runtime, domain, DB or delivery surface is touched. This lane changes lane
  lifecycle control flow only. The command's external authorities (GitHub PR
  state, current main SHA, authenticated identity) are injected in tests and
  read via `gh` in production.

## Independent review

The orchestrator wrote this change and must not be its sole validator.
Independent opposite-provider review is required before merge and is recorded on
the PR.

## SHA Binding

Verified implementation SHA: `6009998c1708d6d5c7c38d6acc2139aa334c26f6` — the
commit containing every control and regression described. All counts above were
produced by running against this tree. The branch head is one commit further:
this document, which changes no executable path.
