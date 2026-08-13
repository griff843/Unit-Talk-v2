# PROOF: UTV2-1668

MERGE_SHA: c22b231e1548fbd60175393902328f6afa713b32

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

### Controls proven by making them fail

```
MUTATION A -- mandatory-input check removed
not ok 10 - every supersession input is mandatory
not ok 33 - the production CLI entry point runs and fails closed on missing arguments
# tests 109   # pass 107   # fail 2

MUTATION B -- self-supersede permitted                     not ok 11   # pass 108  # fail 1
MUTATION C -- merged -> non-success terminal restored      not ok 17   # pass 108  # fail 1
MUTATION D -- lane-manifest bypass refusal removed         not ok 31   # pass 108  # fail 1
MUTATION E -- PR identity agreement dropped                not ok 20   # pass 108  # fail 1
MUTATION F -- closed/unmerged PR state check dropped       not ok 22   # pass 108  # fail 1
MUTATION G -- rejected-head match dropped                  not ok 23   # pass 108  # fail 1
MUTATION H -- ancestry check dropped                       not ok 24   # pass 108  # fail 1
MUTATION I -- unverifiable GitHub treated as permission    not ok 25   # pass 108  # fail 1
MUTATION J -- conflicting re-run overwrite permitted       not ok 28   # pass 108  # fail 1
MUTATION K -- post-condition release verification removed  not ok 30   # pass 108  # fail 1
MUTATION L -- mergeCommit consulted as merge evidence      not ok 15   # pass 108  # fail 1
MUTATION M -- already-shipped refusal removed              not ok 19   # pass 108  # fail 1
MUTATION N -- actor authority check removed                not ok 34   # pass 108  # fail 1
MUTATION O -- ancestry vs stale local origin/main          not ok 35   # pass 108  # fail 1
MUTATION P -- unreadable remote main = permission          not ok 35   # pass 108  # fail 1
MUTATION Q -- superseded-branch write guard removed        not ok 36   # pass 108  # fail 1
MUTATION R -- receipt root reverted to per-worktree
not ok 26 - a closed unmerged lane reaches a terminal non-shipped state with resources released
not ok 29 - a crash between manifest commit and lease release stays visible and resumable
# tests 109   # pass 107   # fail 2

RESTORED (lane-supersede + lane-manifest + shared)
# tests 109   # pass 109   # fail 0
```

**Eighteen groups, no survivors**, each killed only by its own regression.

### The refusal remedy is executed, not merely named

`ops:lane-manifest update --status superseded` is spawned as a real process,
observed to exit non-zero, and its message asserted to name
`lane-supersede.ts`. The named remedy is then **run**, and the lane observed to
reach `superseded`. A refusal that names a remedy is not tested until the remedy
has been executed and seen to succeed.

### Commands executed (explicit references)

- `pnpm exec tsx --test scripts/ops/lane-supersede.test.ts` — PASS, 28 tests, 28 pass, 0 fail, 0 skipped.
- `pnpm exec tsx --test scripts/ops/lane-supersede.test.ts scripts/ops/lane-manifest.test.ts scripts/ops/shared.test.ts` — PASS, 109 tests, 109 pass, 0 fail.
- `pnpm exec eslint scripts/ops/lane-supersede.ts scripts/ops/lane-manifest.ts scripts/ops/shared.ts` — PASS, no output.
- `npx tsx scripts/ops/tier-classifier.ts --declared-tier T1` — derived T1, mechanical minimum T1, `escalated: false`.
- `pnpm type-check` — does NOT compile `scripts/ops/**`; `tsconfig.json` references only `packages/*` and `apps/*`. Tracked separately; deliberately not fixed here.
- `pnpm verify` — deferred to PR CI, which is authoritative for this lane.

## Verification

| Check | Result | Evidence |
|---|---|---|
| Focused suite | PASS | 28 tests, 28 pass, 0 fail, 0 skipped |
| Full module set | PASS | 109 tests, 109 pass, 0 fail |
| `pnpm exec eslint` | PASS | no output |
| Mutation groups A–R | Each regression fails | 18 groups, **0 survivors** |
| Refusal remedy executed | PASS | bypass refused, remedy run, lane reached `superseded` |
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

Verified implementation SHA: `c22b231e1548fbd60175393902328f6afa713b32` — the
commit containing every control and regression described. All counts above were
produced by running against this tree. The branch head is one commit further:
this document, which changes no executable path.
