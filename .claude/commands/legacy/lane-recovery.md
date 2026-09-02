# /lane-recovery

> **LEGACY — not the execution path.**
> This skill belongs to the prior Linear/lane execution primitive, superseded by the
> mission-native model in `docs/mission/intent.md`. It is retained to read historical
> lanes and to finish lanes that are still open. **Do not admit new work through it.**
> New work: `docs/mission/plan.md` → worktree/branch → PR → green CI. See `/mission`.

Triage and repair a lane whose state has already broken. `/lane-management` is the forward path — start, progress, close. This skill is the reverse path: a lane is stuck, a gate is refusing, or manifest / Linear / GitHub disagree, and you need to know which repair to run.

**Never invent a repair.** Every fix below is an existing governed script. If the symptom is not in this tree, stop and report it — do not hand-edit a manifest, delete a lease, or force a status.

---

## Rule 0 — identify the symptom before touching anything

```bash
pnpm ops:substrate-guard            # fail-closed: is the substrate even safe?
pnpm ops:execution-state            # active lanes, slots, stale heartbeats, merge mutex
pnpm ops:orchestration-reconcile --current --json
pnpm ops:lane-manifest -- status UTV2-### --json
```

Substrate-guard exit 1 means HALT. Do not proceed to any repair until its condition clears — a repair run on unsafe substrate is how residue spreads.

---

## Symptom → repair

### S1. `ops:lane-start` hard-fails "active lane missing worktree"

The blocker is a **leaked lease**, not a manifest. `merged` and `done` are not active-lock statuses, so a manifest in either state cannot be the cause.

```bash
pnpm ops:lease report
pnpm ops:lease release --issue UTV2-### --branch <branch> --executor <executor> --cwd <path>
pnpm ops:lease-recover            # reclaim expired leases in bulk
```

Re-run `ops:substrate-guard` before retrying lane-start.

### S2. `File scope lock` fails on paths the lane legitimately owns

Two distinct causes — diagnose before acting:

- **Control-plane paths.** The guard reads the manifest as of its *first-adding commit* (`firstAddingCommit(base, head, path)`), so PR-time edits to `file_scope_lock` are ignored by design. The lane's own `.ops/sync/UTV2-###.yml` and `docs/06_status/lanes/UTV2-###.json` must be declared in `file_scope_lock` **at lane-start**, not added later.
- **Reopened lane / second increment.** The guard reads the manifest from base, where the closed increment still sits. This is expected and cannot be fixed by editing the branch.

Widening scope after the fact requires a PM `scope-override/v1` comment on the PR. That is the only exit. Do not rewrite history to smuggle a wider manifest into the first-adding commit.

```bash
pnpm ops:scope-diff --issue UTV2-### --json   # what the guard actually sees
```

### S3. Ghost lane — PR merged, manifest still `in_progress`

Blocks every subsequent lane's file-scope lock and concurrency check.

```bash
pnpm ops:lane-close UTV2-### --repair-merged
```

`--repair-merged` re-derives the merge binding from GitHub's authoritative `pr.mergeSha`. As of UTV2-1613 it appends **nothing** to `truth_check_history` — the only writer there is the real `runTruthCheck()` in `main()`. If it refuses with `repair_required_via_pr`, you ran it from a checkout on `main` and it produced tracked changes; those changes must land through a governed branch and PR, not a direct push.

### S4. Post-merge lane-close reports "no merged PR found"

Usually means *ambiguous*, not absent — multiple PRs opened off one lane branch. Re-run the closer with an explicit PR:

```bash
gh workflow run post-merge-lane-close.yml -f pr=<number>
```

Then release the local lease (S1) and re-run Linear auto-close by hand if the issue is still in an executing state.

### S5. Manifest missing `pr_url` or `commit_sha`

```bash
pnpm ops:lane-manifest -- record-merge UTV2-### --pr <url-or-number> --json
pnpm ops:proof-generate --merge-sha <sha>
pnpm ops:truth-check UTV2-###
pnpm ops:lane-close UTV2-###
```

`record-merge` writes status, `commit_sha`, `pr_url`, and heartbeat — nothing else. It leaves `truth_check_history` byte-for-byte as supplied and always reports `historyAppended: false`. It cannot measure a verdict and does not claim one.

### S6. `ops:truth-check` fails early and the report looks thin

Truth-check **exits at the first failing milestone**. An M2 manifest-schema violation hides every downstream merge-binding, P3, and P12–P14 result. A short failure list is not a short problem list.

Repair the reported milestone, then re-run and read the *new* failures as if they were the first ones. Iterate to a clean `pass (N checks, 0 failures)` — never reason about what "would probably pass".

### S7. Manifest drifted or schema-invalid

```bash
pnpm ops:lane-manifest -- validate UTV2-### --json
pnpm ops:manifest-repair --json
```

### S8. Proof bound to the wrong SHA

```bash
pnpm ops:proof-rebind --issue UTV2-### --merge-sha <sha> --apply
```

See `/proof-authoring` for what the rebind requires to be present in the file first — the `Merge SHA:` field must hold a real SHA or the literal `N/A`. Prose in that field makes rebinding refuse and strands the lane merged-but-unclosed.

### S9. Untracked manifest shadow in the shared checkout

An `ops:lane-manifest update` run from the root checkout writes to `main`'s working tree, not the lane branch. The shadow survives `git pull` and diverges from `main`, so a later executor reads the wrong state.

```bash
git status --porcelain docs/06_status/lanes/
```

Any untracked or modified manifest in the root checkout for a lane you are not currently controlling is residue. Reconcile it against `main` before doing anything else.

### S10. Worktree residue

Worktree reaping only happens behind `--repair-merged`, and the nightly cleanup workflow has a long failure history. Check the count before blaming WSL for memory pressure:

```bash
git worktree list | wc -l
pnpm ops:lane-clean --dry-run
```

Push any unpushed commits before pruning. Never prune a worktree with uncommitted work.

### S11. `main` sync rewrote history

`ops:merge-wrapper main-sync` falls back to a rebase when fast-forward fails. On a long-open lane that rewrites every SHA on the branch and can drop files — a proof bundle has been lost this way.

Before any main-sync on a lane older than a day, record the current head. After it returns, diff the file list:

```bash
git rev-parse HEAD
git diff --name-status <recorded-sha> HEAD
```

If the proof bundle or manifest disappeared, restore from the recorded SHA — do not regenerate, or the new proof will bind to the wrong content.

---

## Ordering rule

When several symptoms are present, repair in this order — earlier repairs unblock later ones, and the reverse order corrupts state:

1. Substrate (S1 leases, S10 worktrees)
2. Manifest truth (S5, S7, S9, S11)
3. Proof binding (S8)
4. Truth-check (S6)
5. Close (S3, S4)

---

## Rationalization resistance

- "The manifest looks right to me" — `ops:lane-manifest -- validate` is the authority, not inspection.
- "It's merged, so it's done" — merged is rank 1 truth for *code*. Done is `ops:truth-check` exit 0.
- "I'll just fix the JSON by hand" — a hand-edited manifest has no provenance and will fail S2 scope-diff or M2 on the next run.
- "Only one check failed" — see S6. Truth-check stops at the first failure.

## Red flags — stop and report

- A repair script that reports success but changed nothing you can name.
- A `truth_check_history` entry whose `runner` you cannot trace to an actual command invocation.
- Substrate-guard passing only after you passed `--force-unsafe-substrate`.
- Any urge to force-push to `main`, or to close a lane whose truth-check never exited 0.
