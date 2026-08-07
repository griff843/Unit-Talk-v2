# PROOF: UTV2-1567

MERGE_SHA: 116f3f3ff1b49ecf7b5a819bf42a651bc31c59d9

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
- [x] **UTV2-1589's `github.event_name == 'push'` restriction on that step is preserved verbatim through the merge.** It is *not* enforced by a new test in this PR — see "Regression coverage moved out of this lane" below
- [x] Merged `origin/main` into this branch as a true merge (no rebase), per PM directive 2026-08-07. One conflict, in this PR's own file, resolved as described above
- [x] All five lane/proof/sync artifacts verified byte-identical (blob hashes) before and after the merge
- [x] Regression coverage **deliberately removed from this PR** and reassigned to UTV2-1673 (PM decision 2026-08-07) — see below
- [x] The push-only guard test was **negative-controlled** while it existed: proven to fail when the gate is widened, not merely to pass as written. That method, and the three assertions themselves, transfer to UTV2-1673
- [x] YAML parses validly
- [x] `pnpm verify` PASS on gates and suites: `system-alignment` PASS, `automation-coverage` PASS, `executable-wiring` PASS, lint/type-check/build clean, 0 `not ok`. Locally it stops at `pnpm test:db`, which **refuses by design** off-CI (`[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx`). That step is executed by CI's staging-only writable-DB proof, not waived

## Regression coverage moved out of this lane (PM decision 2026-08-07)

This PR originally added `scripts/ops/post-merge-lane-close-workflow.test.ts`
with three assertions, including a guard that UTV2-1589's push-only
restriction survives. **That file has been removed from this PR**, and the
coverage is reassigned to UTV2-1673. Nothing about the workflow change itself
is affected.

Why: `pnpm test` composes explicit test lists, not globs, so a new test file is
unreachable until it is named in `package.json`'s `test:ops`. `package.json` is
outside this lane's `file_scope_lock`, and scope cannot be widened after the
fact — `resolveTrustedManifests` in `scripts/ci/file-scope-guard.ts` pins a
branch-introduced manifest's declared scope to the first commit that added it,
precisely so a later commit cannot bless its own out-of-scope edit. The gate
said so directly:

```text
[FAIL] WIRING_TEST_UNWIRED_NEW scripts/ops/post-merge-lane-close-workflow.test.ts
  - test file is not reachable from any package script or workflow command and
    is not in the reviewed wiring baseline
```

The two sanctioned remedies (wire it in, or add a reviewed baseline entry) both
require an out-of-scope file, so both would have needed a PM scope override.
**PM declined to spend one on a test that still would not execute in CI** — the
override budget exists to remove future bootstrap needs, not to land inert
enforcement. UTV2-1673 must touch this same workflow to make replay binding
safe, and can declare `package.json` in scope from lane-start, so the
assertions land there **wired** instead of here **inert**.

What transfers to UTV2-1673, in full:

1. `resolve_sha` branches on `workflow_dispatch` and reads the merge SHA via
   `gh pr view … --json mergeCommit`.
2. The bind step consumes `steps.resolve_sha.outputs.merge_sha`, never
   `github.sha` directly.
3. The push-only guard: the bind step's `if:` must match
   `github.event_name == 'push'` **and** must not match `workflow_dispatch`
   at all.

Assertion 3 needs both halves, and that is the transferable lesson. A first
revision asserted only `match(/github\.event_name == 'push'/)` — which **still
matches inside** a widened
`(github.event_name == 'push' || github.event_name == 'workflow_dispatch')`
disjunction. Verified by negative control against a deliberately widened gate:

```text
A) clean tree                        -> ok 3   (# pass 3, # fail 0)
B) gate widened to admit dispatch    -> ok 3   (# pass 3, # fail 0)   <-- useless
```

After adding `doesNotMatch(/workflow_dispatch/)`:

```text
A) clean tree                        -> ok 3   (# pass 3, # fail 0)
B) gate widened to admit dispatch    -> not ok 3 (# pass 2, # fail 1)
C) restored                          -> ok 3   (# pass 3, # fail 0)
```

State B is the failure the guard exists to produce. A guard that cannot be made
to fail is not a guard — write the negative control before trusting it.

## EVIDENCE:

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

## Standalone type-check, unit suite, and R-level compliance

Added for the close-eligibility repair. CEP flagged `CEP-E4/P12` (verification
log must reference `pnpm type-check` and `pnpm test`) and `CEP-E4/P14` (must
reference `scripts/ci/r-level-check.ts`) on this lane's head **before merge**.
Both were executed standalone against the post-merge head rather than asserted
from the `pnpm verify` run.

```text
$ pnpm type-check
```

Result: PASS, exit code 0 (`pnpm exec tsc -b tsconfig.json`, full
project-references build, no diagnostics).

```text
$ pnpm lint
```

Result: PASS, exit code 0.

```text
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD

Verdict: PASS
Changed files: 7
Rules matched: (none) — no R-level artifacts required for this diff
```

Exit code 0.

```text
$ pnpm test

# tests 4579
# pass 4579
# fail 0
```

Exit code 0, aggregated across all suites; zero `not ok` lines in the run.

**This total is unchanged — to the test — from the run taken while
`scripts/ops/post-merge-lane-close-workflow.test.ts` was still present:**

```text
with the test file present:  # tests 4579  # pass 4579  # fail 0
with the test file removed:  # tests 4579  # pass 4579  # fail 0
```

Deleting a three-assertion test file moved the suite count by **zero**, because
`pnpm test` never reached it. That is the finding demonstrating itself, and it
is the most direct evidence in this bundle for the principle recorded in
`diff-summary.md`: presence is not enforcement. Had the file shipped, the proof
would have cited "3/3 passing" as coverage while `verify` executed none of it.

See the regression note below for the failure the first of these runs produced
and how it was fixed.

### Recorded red run: this merge broke three of UTV2-1589's own tests

The first `pnpm test` after the merge failed **3 / 2055**, all in
`scripts/ops/lane-close.test.ts`:

```text
not ok 968 - UTV2-1589 workflow_dispatch never runs the ordinary "Bind proof artifacts …" step
not ok 969 - UTV2-1589 "Bind proof artifacts …" also skips when a governed manifest-only repair PR merges via push
not ok 970 - UTV2-1589 "Bind proof artifacts …" never binds model-routing.json itself
```

Cause — and it is a genuine latent fragility in the *checking* code, not just
an authoring slip. Those tests locate the step under test with a bare
first-occurrence scan:

```js
const bindStepIndex = workflow.indexOf('Bind proof artifacts to merge SHA');
```

The honest-partial comment added to the `Resolve merge SHA` step referred to
its consumer **by that exact name**. Because the comment sits *above* the real
step, `indexOf` matched the comment, and all three tests silently asserted
against the wrong step's `if:` — reporting a UTV2-1589 safety regression that
did not exist. The push-only guard was intact the whole time.

Fixed by removing every occurrence of that string above the step's own
`- name:` line, and leaving a comment at the site explaining why it must stay
that way. Notably the *first* fix attempt still failed, because it quoted the
offending string verbatim while explaining the hazard — recorded here because
that is precisely how this class of defect survives review.

**This is a name-collision fragility worth generalizing:** a static workflow
assertion that locates its target by unanchored `indexOf` on a human-readable
step name can be retargeted by any prose that mentions the name. It fails
*loudly but misleadingly* — pointing at a safety regression rather than at
itself. Anchoring the scan to `- name: ` would remove the whole class.

## Tier

T2 — CI workflow logic only. No runtime, domain, or DB code touched, and no
test file ships with this PR (coverage reassigned to UTV2-1673).

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
