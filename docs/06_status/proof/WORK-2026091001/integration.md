# Tracker independence staged integration

MERGE_SHA: pending merge

## Summary

PR #1556 is the evaluator foundation and local workflow cutover. Its P0 Actions
consumer remains byte-for-byte equal to the current base version. The full cutover
is not complete until the consumer activation and post-merge workflow checks below
pass. This document records sequencing in the existing lane, not a new framework.

## Verification

The activation diff is `p0-consumer-activation.patch` in this directory. SHA-256:
`f5a7928b2f60f5b76fb1a85669c64628af90410984e7404524228b88fd0541be`.
`git apply --check` passes against the foundation tree. It changes only
`.github/workflows/p0-protocol.yml`; the evaluator and classification registry are
already supplied by the foundation. The consumer reads the protected main SHA,
checks out that trusted base, and evaluates the candidate without running its code.

## Integration order

1. Land the foundation, #1556, under its own identity `WORK-2026091001` through
   the merge path that is installed on `main` today. Measured at head
   `a9cc5303567c8fbad48476ad30f19c8f720c9cf6` against base `14124f02a`:
   - **`Merge Gate` resolves this lane.** `merge-gate.yml` extracts
     `(utv2|uni|work)-\d+` from the branch, reads
     `docs/06_status/lanes/WORK-2026091001.json` at the PR head and resolves
     tier **T1** (the same run's tier-sync step prints `Manifest tier: T1`;
     the branch wrapper's receipt records `tier.source: lane_manifest`). It
     refuses **only** the T1 approval artifacts: the `t1-approved` label and a
     `pm-verdict/v1` APPROVED comment from CODEOWNERS bound to this exact head.
     An earlier revision of this step said the gate fails with *"No issue ID
     found in PR branch or title"*; that was measured on an older gate and is
     withdrawn here.
   - **The wrapper that performs the merge is the one installed on the base**,
     run from the root checkout on `main` after `git pull --ff-only`:
     `pnpm ops:merge-wrapper pr-merge --issue WORK-2026091001 --branch
     codex/work-2026091001-tracker-independence --pr 1556`. Its
     `pre-merge-authorization` receipt at this head resolves the label tier T1,
     requires the `pm-verdict/v1`, and refuses on exactly *"required checks
     missing or failing on head …: Merge Gate | T1 requires a valid
     pm-verdict/v1 comment"*. The base wrapper carries no repo-minted
     boundary: `origin/main:scripts/ops/pre-merge-authorization.ts` contains
     no `repoMintedP0` predicate. Running this branch's own wrapper instead
     refuses the same PR (`repoMintedP0.covered: false`, base `14124f02a`),
     because the boundary it installs reads the base consumer, which has not
     been activated; the foundation is therefore merged with the base wrapper,
     which is not a bypass of the branch's control — that control is not
     installed until this merge lands.
   - **No bootstrap identity and no replacement lane.** A
     `docs/governance/BOOTSTRAP_AUTHORIZATIONS.json` entry is accepted only
     when no lane manifest exists and this lane has one, so the earlier
     sentence naming that file as a fallback is withdrawn; a tracker-keyed
     replacement lane (an earlier revision named UTV2-1887, which never
     existed) is not created.
   - **The one unresolved scope authorization is a `scope-override/v1` for six
     paths.** The trusted-base scope guard reports eight paths outside this
     lane's `file_scope_lock`. Two are the lane's lifecycle pair
     (`docs/06_status/lanes/WORK-2026091001.json`,
     `.ops/sync/WORK-2026091001.yml`), which the guard on `main` grants only to
     `UTV2-` ids and the merged guard grants to `WORK-` ids as well. The other
     six are `.github/workflows/file-scope-lock-check.yml`,
     `.github/workflows/return-review-packet.yml`,
     `scripts/ci/file-scope-guard.ts`, `scripts/ci/file-scope-guard.test.ts`,
     `scripts/ci/scope-override-comment-parser.ts` and
     `scripts/ci/scope-override-comment-parser.test.ts`. Pre-merge, `File scope
     lock` and `Return review packet` are non-required and stay red on this
     head; that red is not treated as authorization. At closeout, `S1`
     evaluates the manifest's `files_changed` against the lock, the lifecycle
     grant of the merged guard and any `scope-override/v1` comment authored by
     CODEOWNERS whose `Issue:` is `WORK-2026091001`, whose `PR:` is 1556 and
     whose `Head SHA:` equals the PR head byte-for-byte — the merged parser
     admits the `WORK-` id. Without that comment `S1` fails on exactly those
     six paths and the lane cannot close; with it, `S1` passes. The comment is
     reserved to CODEOWNERS, is requested in the PR packet with its exact text,
     and is not authored here.
2. Integrate #1556 through that base-installed serialized merge wrapper after
   the required checks and both T1 approval artifacts are on the stationary
   head. Verify its merge is reachable from protected `main` and that
   `scripts/ops/tracker-independence/p0-workflow.cjs` exists at that exact SHA.
3. Land the consumer activation as a **tracker-keyed** follow-up lane, not as a
   `WORK-###` PR. Once the foundation is on `main`, the installed wrapper
   refuses every repo-minted head until the base consumer delegates to the
   evaluator — and that delegation is exactly what the follow-up installs, so a
   repo-minted follow-up could never merge through the wrapper. The only lane
   types admitting `.github/workflows/**` are `runtime` and `migration`; the
   latter is refused by `forbidden_combination` while #1484 is open. Apply the
   recorded patch with `git apply --check` followed by `git apply`; review any
   base drift before applying. Run the classifier and workflow regression
   tests, `pnpm verify`, and required CI. Obtain the follow-up's existing
   review and merge authorizations. Do not disable the old required check to
   make either phase pass.
4. Verify the installed workflow on a new ordinary task and an existing PR with
   stale Linear credentials; verify protected and unresolved classifications still
   refuse progression without the applicable evidence. Recover mission and active
   work in fresh and compacted sessions using repository state. Capture real merged
   workflow evidence before claiming tracker independence or closing this lane.

## Repo-minted execution is refused by local controls between the phases

Between phase 2 and phase 3 the installed consumer is still the narrow one, and
it *auto-passes* a `WORK-###` PR: the required `P0 Protocol` check concluded
`success` on this PR's own head in 10s (run `34599912852`). Three local controls
refuse repo-minted execution while that is true, and each one reads the
**installed trusted base**, never the working tree or a branch head:

- `evaluateRepoMintedP0Coverage` (`scripts/ops/shared.ts`) runs
  `git show origin/main:.github/workflows/p0-protocol.yml` and parses it: coverage
  is a live, non-ignorable step of the `P0 Protocol` job on a `pull_request`
  trigger whose literal-blanked body invokes
  `scripts/ops/tracker-independence/p0-workflow.cjs`, with the evaluator present
  at the same base commit. The review's mutation — appending a comment naming the
  evaluator to the narrow consumer — returns `covered: false`, as does the
  activation applied only on a branch. The receipt records the ref and commit.
- preflight check `PW1` fails on it at every tier, and `ops:lane-start` refuses a
  new repo-minted lane with `p0_consumer_not_activated` before any lease,
  worktree or manifest exists.
- the merge wrapper's `pre-merge-authorization` refuses a repo-minted head ref
  whose trusted-base coverage is absent, so a candidate manifest that already
  exists on a branch — which never passes admission again — is held to the same
  line on the sanctioned merge path.

These are **not** required-check enforcement, and this packet no longer claims
that admission is "a complete chokepoint" because `ops:lane-start` is the only
writer of the lane manifest: `merge-gate.yml` reads whatever manifest the
candidate head carries, and any committer can write one. The controls guarantee
that the repository's own admission tooling refuses to open or authorize a
repo-minted lane unless the consumer installed on `origin/main` contains a live
`actions/github-script` step in the `P0 Protocol` job whose body, read
literally, calls the evaluator's `evaluatePullRequest` export through a
`require` of the evaluator path in one of three statement-level forms
(inlined, destructured, or through a `const` module binding), and contains
no other ASCII spelling of that module or that name: every string and
template literal is blanked first; a body with any `/`, backslash, control
or non-ASCII character outside a string (comment, regex literal, division,
Unicode-escaped identifier), a raw LF or CR inside a quote, a template
substitution, `eval`,
`Function`, `with`, `import`, `module`, `globalThis`, any `require` that is
not a bare `require(` with an adjacent parenthesis and a string literal or the
unique `const` path binding as its argument, a redefinition of `require`
or of the entry point, a duplicate or assigned path binding, or any other
occurrence of the entry-point name, a module binding, the path literal or a
`require` of it is refused. A shell `run:` never counts: the evaluator has no
CLI entry point. The tests enumerate the shapes seven review rounds probed,
each refused: any shell form, comment-only references, strings (including
backslash-newline continuations) and template literals, nested `require`, a
bare `require` with no call, a shadowed or redefined entry point or `require`,
a reassigned `let` or `const` binding, a forked `actions/github-script-*`
action, a fake property named after the entry point, the export reassigned or
replaced (through a tracked or unbound module reference, `Object.assign`,
`Object.defineProperty`, `Reflect.set`, a getter, a bracket access,
`require.cache`, `eval` or `new Function`) before the call, a computed or
concatenated `require` argument, a `//` inside a string ahead of a mutation,
the entry point passed by reference, a renamed or widened destructuring, a
dynamic `import`, suffix paths, literal-false `if:`, non-false
`continue-on-error` at step or job level, `needs:` on a disabled or absent
job, an empty or any-`exclude` matrix, a duplicate `P0 Protocol` job,
candidate-only activation and existing candidate manifests. Not assessed:
JavaScript control flow (including a body that throws before the call, which
fails the required check and is fail-closed for the PR), runtime `if:`
expressions, `timeout-minutes`, the same check name reported by another
workflow, and a mutation of the loaded module through a reference obtained
without naming `require`, `module`, `eval`, `Function` or `import` (for
example a helper module already on the base) — none introducible by a WORK PR
author, since the predicate never reads candidate content. The foundation itself
reaches `main` under its own identity through the base-installed merge path in
step 1 above, and the block releases only when the activation is installed on
the base — re-arming if a
later base commit removes the delegation. See
`docs/05_operations/P0_PROTOCOL_SPEC.md` § "The staged block is mechanical".

The old P0 consumer can still attempt Linear access during phase 1. If its check
cannot pass under its existing authority, that is a concrete bootstrap integration
dependency for the authorized integrator; this packet does not grant an exemption.
PRs #1491/#1492 are not prerequisites and their merge-authority redesign is excluded.
