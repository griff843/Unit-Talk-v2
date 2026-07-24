# Existing-Branch Lane Readmission

`--readmit-existing-branch` reconstructs governed lane state for an implementation branch that already has an open pull request but no worktree or active lease. It is a distinct admission mode, not a force flag and not ordinary resume.

Use the same explicit flag during both steps:

```bash
pnpm ops:preflight UTV2-123 \
  --tier T1 \
  --branch codex/utv2-123-example \
  --lane-type governance \
  --executor codex-cli \
  --files scripts/ops/example.ts \
  --readmit-existing-branch

pnpm ops:lane-start UTV2-123 \
  --tier T1 \
  --branch codex/utv2-123-example \
  --lane-type governance \
  --executor codex-cli \
  --model-profile standard \
  --files scripts/ops/example.ts \
  --readmit-existing-branch
```

Run both commands from the clean `main` control checkout. Registry-only state under `.ops/sync/` and `docs/06_status/lanes/` is permitted; implementation and proof changes are not. Local `main`, the current control-checkout HEAD, and `origin/main` must be identical.

## Admission contract

Preflight requires all of the following:

- the target branch exists locally or on `origin`, contains the exact issue identifier, has history related to current `main`, and has no worktree;
- exactly one open PR has the exact head branch and head SHA, with head and base in the current repository, **and its base ref is exactly `main`**;
- the Linear issue is in an explicit continuation state (`In Claude`, `In Codex`, either review state, or `In Progress`) and is not terminal;
- no active or stale-reclaim-required lease exists for the issue or branch;
- no active merge mutex is owned by the issue;
- existing lane metadata, when present, names the same issue and branch;
- tier, executor, new lane type, and file scope are supplied explicitly.

A branch may be behind `main`. Preflight records the exact ahead and behind counts instead of requiring rebasing.

**The preserved open PR must target `main`.** A same-repository PR that targets any other base branch (`release`, `staging`, or otherwise) fails preflight closed, with the failure stating the observed base ref. This is read directly off the live PR at preflight time — it is never inferred or assumed.

The readmission token binds:

- control-checkout and `origin/main` SHA;
- existing branch SHA;
- open PR number and base ref (must be `main`);
- ahead and behind counts;
- issue, branch, tier, executor, requested lane type, and file scope;
- previous lane type when discoverable;
- proof that no worktree, active lease, or issue-owned active merge mutex existed.

Any changed SHA, PR identity, PR base ref, divergence, authority input, or absence fact makes the token stale. Run preflight again; do not substitute `--force-unsafe-substrate`.

## Reconstruction contract

Lane-start re-fetches `origin/main` and the exact target branch, then revalidates the token and current external state before side effects. It adds a worktree from the existing branch without `git checkout`/`git switch` in the root checkout and without creating a replacement branch from `main`. Existing implementation commits and proof files remain intact.

Lane-start independently re-fetches the open PR and rejects a base ref other than `main`, even if the branch, head SHA, and PR number are unchanged. This check does not consult or trust the token's own claim about the base ref — a malformed or tampered token cannot substitute for the live re-check. If the PR was retargeted after preflight, lane-start fails closed with `open PR base ref changed after preflight`.

File-scope paths are resolved against the existing target branch during readmission, so files or directory globs introduced by that branch do not need to exist on `main`. A declared non-proof path that is absent from the target branch still fails closed before worktree or lease creation.

The reconstructed lane receives an identical local copy of the validated preflight token at its manifest-referenced path, isolated pnpm state, a fresh lease, a fresh manifest using the newly requested lane type, and a fresh sync record. Prior lane type is recorded as history and is never inherited as current authority. Only regenerated lane metadata is committed. Success returns:

```text
lane_readmitted_existing_branch
```

Ordinary admission and ordinary resume are unchanged:

- a branch that does not exist follows normal fresh admission;
- an existing branch with its worktree and valid manifest follows `lane_resumed`;
- an existing branch without a worktree still fails unless the explicit readmission flag and validated readmission token are present.

## Transactional failure behavior

If reconstruction fails after worktree creation, lane-start removes the partial worktree. If lease reservation or later metadata work fails, it also releases the lease and restores the prior control-checkout manifest/sync files. A locally materialized tracking ref is removed only when lane-start created it during the failed transaction. The root checkout stays on `main`.
