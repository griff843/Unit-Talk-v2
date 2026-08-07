# PROOF: UTV2-1567

MERGE_SHA: 7c25ed65882caf8d99b5c0290f3161159624c8ba

The SHA above is `main`'s HEAD at the time this lane branched, an ancestor
of the eventual PR merge commit — per this repo's accepted proof-binding
convention, a commit cannot embed the hash of the merge commit it will
later become part of.

## Verification

CI workflow logic only, no runtime/domain/DB code touched.

## SCOPE LIMITATION — this lane does NOT deliver its issue's capability

**PM decision 2026-08-04. Residual capability tracked as UTV2-1673.**

UTV2-1567's acceptance criterion was "a `workflow_dispatch` replay binds proof
to that issue's actual merge commit". **This lane does not achieve that, and
must not be recorded as having done so.**

While this PR sat open, `main` closed the same defect differently and more
conservatively. UTV2-1589 (PR #1308, merged 2026-07-25 — four days after this
branch's last substantive commit) restricted the *only consumer* of this
lane's `resolve_sha` output — the "Bind proof artifacts to merge SHA" step —
to `github.event_name == 'push'`, because an early bind on a replay trusts
`manifest.pr_url` from disk with no GitHub-backed validation and can
permanently deadlock `model-routing.json`'s immutable `closeout_binding`.

Consequence: **`resolve_sha`'s `workflow_dispatch` branch is correct code that
cannot be reached.** On `push` it returns `github.sha`, so runtime behavior is
byte-for-byte identical to `main` before this lane. The safe path for replay
binding today is `ops:lane-close --repair-merged`, which resolves the SHA from
GitHub's authoritative `pr.mergeSha` on every trigger and runs unconditionally
in this same workflow.

This lane therefore lands as an **honest partial**: the conflict resolution and
UTV2-1589's safety restriction are both preserved, and the capability is
explicitly not claimed. UTV2-1673 owns the real fix (PR identity validation,
merge-SHA ownership + reachability, and separate authorization for immutable
artifacts) — after which the gate may be widened, and not before.

## ASSERTIONS:

- [x] `post-merge-lane-close.yml` has a "Resolve merge SHA" step that reads the merge SHA via `gh pr view <pr_url> --json mergeCommit` on `workflow_dispatch` — **present and correct, but unreachable in effect; see SCOPE LIMITATION above**
- [x] The `push`-triggered path is unchanged (still resolves to `github.sha`, which is correct there)
- [x] "Bind proof artifacts to merge SHA" consumes `steps.resolve_sha.outputs.merge_sha`, not `github.sha` directly
- [x] **UTV2-1589's `github.event_name == 'push'` restriction on that step is preserved verbatim through the merge, and is now enforced by a regression test**
- [x] Merged `origin/main` into this branch as a true merge (no rebase), per PM directive 2026-08-07. One conflict, in this PR's own file, resolved as described above
- [x] All five lane/proof/sync artifacts verified byte-identical (blob hashes) before and after the merge
- [x] Regression tests added and passing: `scripts/ops/post-merge-lane-close-workflow.test.ts` (3 tests)
- [x] The new push-only guard test was **negative-controlled**: proven to fail when the gate is widened, not merely to pass as written
- [x] YAML parses validly
- [x] `pnpm verify` PASS

## EVIDENCE:

Regression suite on the post-merge head:

```text
$ npx tsx --test scripts/ops/post-merge-lane-close-workflow.test.ts
# tests 3
# pass 3
# fail 0
```

### Negative control for the push-only guard

A guard test that cannot fail is not a guard. The third test was verified
against a deliberately widened gate before being accepted. An earlier revision
of this guard asserted only `match(/github\.event_name == 'push'/)`, which
**still matched inside** a widened
`(github.event_name == 'push' || github.event_name == 'workflow_dispatch')`
disjunction — it passed the negative control and was therefore useless. It was
strengthened with an explicit `doesNotMatch(/workflow_dispatch/)` and re-run:

```text
A) clean tree                        -> ok 3   (# pass 3, # fail 0)
B) gate widened to admit dispatch    -> not ok 3 (# pass 2, # fail 1)
C) restored                          -> ok 3   (# pass 3, # fail 0)
```

State B is the failure this guard exists to produce.

### Artifact preservation across the merge

Identical blob hashes before and after merging `origin/main`:

```text
7138e58db03741036cddf505626f26f30cb2e3d8  .ops/sync/UTV2-1567.yml
8638a22f4dc94613da673635a3f6d51fdbfd32d1  docs/06_status/lanes/UTV2-1567.json
e69de29bb2d1d6434b8b29ae775ad8c2e48c5391  docs/06_status/proof/UTV2-1567/.gitkeep
079d14f6eae805d9ca71998b68abf7178ea76e3b  docs/06_status/proof/UTV2-1567/diff-summary.md
a73300d0a57dcb3306d30513065086f548256dfa  docs/06_status/proof/UTV2-1567/verification.md
```

These hashes record that the *merge itself* mutated nothing in this lane's
apparatus — the merge brought in `main` and touched exactly one file, this
PR's own workflow. This file's own hash necessarily changes afterward, in the
separate disclosed commit that adds the SCOPE LIMITATION section above; that
edit is a proof correction, not merge fallout.

```text
$ node -e "yaml.parse(fs.readFileSync('.github/workflows/post-merge-lane-close.yml','utf8')); console.log('YAML valid')"
YAML valid
```

```text
$ pnpm verify
(exit code 0)
```

## Tier

T2 — CI workflow logic + regression test only.

## Live-DB proof (T2 CI-workflow-only lane, no runtime/DB code touched)

This lane's proof directory is audited by `pnpm exec tsx scripts/ops/proof-auditor-gate.ts --require-executed-command "pnpm test:db"`, which applies unconditionally to every changed proof directory regardless of tier. `pnpm test:db` was run against live Supabase solely to satisfy this gate.

```text
$ pnpm test:db
TAP version 13
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
```
