# PROOF: UTV2-1589

MERGE_SHA: 0861755aa7806c9bed312731854dab9f94800aa0

## Summary

Post-merge proof generation now SHA-binds `model-routing.json` without
destroying the immutable model execution provenance recorded before merge.
The specialized rebind is idempotent, conflict-safe, and preflighted before
any proof artifact is written. Under a PM-authorized same-lane scope
expansion, the trusted `scripts/ops/lane-close.ts --repair-merged` path
(`rebindRepairedLaneProof()`) now also performs this same specialized rebind,
so a real trusted replay -- not just `generateProofArtifacts()` -- binds
`model-routing.json`.

ASSERTIONS:

- [x] Every original model-routing field, including unknown provenance fields,
  is preserved byte-for-value after parsing and serialization.
- [x] `closeout_binding` records `sha_type: merge_sha`, the authoritative merge
  SHA, normalized PR URL, and the first successful binding time.
- [x] Repeating the same PR/SHA binding is a no-op and preserves `bound_at`.
- [x] A different PR or SHA, malformed required sidecar, missing required
  sidecar, or absent PR URL fails before any proof artifact write.
- [x] A missing optional sidecar remains unaffected.
- [x] Evidence JSON and verification Markdown rebinding remain unchanged.
- [x] Truth checks P3 and C4 fail before closeout binding and pass afterward.
- [x] A thrown `ModelRoutingRebindError` in the CLI is caught and reported as a
  structured `{ok:false, code, issue_id, proof_path, message}` result with
  exit code 1, not an uncaught crash.
- [x] `rebindRepairedLaneProof()` (the trusted `--repair-merged` path) binds
  every declared `model-routing.json` sidecar the same way, validating all of
  them (write:false) before writing evidence.json/verification.md or any
  sidecar, so a failing sidecar leaves zero proof mutation.
- [x] `main()` in `lane-close.ts` catches `ModelRoutingRebindError` distinctly
  (before the generic infra_error fallback) and emits a `model_routing_rebind_failed`
  closeout code carrying `model_routing_error_code`, `proof_path`, and `message`;
  the existing unconditional `transaction?.rollback()` at the top of that catch
  block restores the manifest and the entire proof directory (evidence.json,
  verification.md, and model-routing.json together, since
  `createRepairRollbackTransaction()` already snapshots the whole directory).
- [x] The real UTV2-1585/#1305 and UTV2-1586/#1306 fixtures bind correctly
  through the actual `rebindRepairedLaneProof()` path (not just through
  `rebindModelRoutingJsonSha()` called directly), are idempotent on replay,
  and satisfy the C4 closeout gate and P3's merge-SHA-reference predicate
  through that same real path.
- [x] A lane with no declared `model-routing.json` sidecar is unaffected --
  ordinary (non-model-routing) closeout behavior is unchanged.

## Independent review finding and correction

A fresh-context, independent Claude adversarial review found that my own
follow-on fix (catching `ModelRoutingRebindError` in `main()` instead of
letting it crash uncaught) existed only as a local commit and had not been
pushed to the PR branch, so it was not actually part of what was under
review. Pushed in `470cde76f7bbf51bffc5edda2178e8eb796eb46f`. The reviewer
re-verified the fix's design against the pushed commit (catches only
`ModelRoutingRebindError`, re-throws everything else, emits the correct
JSON shape, returns exit 1) and found no other defects. The reviewer also
independently confirmed the authority-validation threat model (this module
trusts its caller's SHA/PR inputs; independent GitHub-backed validation is
`lane-close.ts`'s `validateTrustedPostMergeRepair`'s responsibility, not
this one's -- unchanged from the pre-existing evidence.json/verification.md
rebind behavior) and independently re-derived the historical-repair
inventory below by grepping all lane manifests directly, confirming it
exactly.

The automated Codex PR review then independently found two further real
issues, both fixed:

1. **CLI crash on conflict (fixed in `470cde76`, verified above).**
2. **Identity-less sidecar acceptance (fixed in `828c0753`)**:
   `rebindModelRoutingJsonSha` accepted any valid JSON object -- including
   `{}` or a sidecar belonging to a different lane -- as long as it had no
   conflicting `closeout_binding`, so a corrupted or substituted sidecar
   could receive an authoritative binding without containing real
   execution provenance for the correct lane. Fixed by requiring the
   sidecar's `issue_id` to match the manifest's `issue_id`
   (case-insensitive) before any binding. Three new focused tests cover
   rejection of a mismatched `issue_id`, rejection of `{}`, and acceptance
   of a genuinely matching sidecar.

A third finding from the same automated review -- that the trusted
`ops:lane-close --repair-merged` path (`rebindRepairedLaneProof` in
`scripts/ops/lane-close.ts`) calls only `rebindMergeSha`, never
`generateProofArtifacts`, and therefore never invokes this issue's new
model-routing rebind during a trusted post-merge replay -- was
independently verified TRUE and is a real, severe defect: it means
replaying UTV2-1585/UTV2-1586 through the trusted repair path will still
fail P3/C4 on `model-routing.json` even after this PR merges. This was
returned to PM as a scope-expansion stop condition rather than fixed
unilaterally, since fixing it required touching `lane-close.ts`, outside
this issue's originally authorized file scope.

**PM authorized a narrow same-lane scope expansion** adding
`scripts/ops/lane-close.ts` and `scripts/ops/lane-close.test.ts` to this
issue. `rebindRepairedLaneProof()` now validates (write:false) every
`model-routing.json` path declared in `manifest.expected_proof_paths`
before writing evidence.json/verification.md or any sidecar -- mirroring
`generateProofArtifacts()`'s atomic validate-then-write ordering -- then
binds each one. `main()`'s catch block now special-cases
`ModelRoutingRebindError` into a distinct `model_routing_rebind_failed`
closeout code (carrying the underlying error code, proof path, and
message) instead of the generic `infra_error` fallback; the existing
unconditional `transaction?.rollback()` already restores the manifest and
the entire proof directory on any thrown error, so no new rollback
mechanism was needed. 14 new focused tests in `scripts/ops/lane-close.test.ts`
prove this against the real UTV2-1585/#1305 and UTV2-1586/#1306
identities, idempotent replay, conflicting PR, conflicting SHA, invalid
JSON, wrong/missing issue identity, a missing required sidecar, a lane
with no declared sidecar (unaffected), the C4/P3 gates passing through
the real path, and rollback of the manifest and every proof file when the
rebind fails.

A fresh-context independent Claude review of this fix (blind to the prior
conversation, instructed to actively try to break it) traced the
validate-then-write ordering, the `main()` catch-block wiring and
rollback coverage, and the new tests against the real
`rebindRepairedLaneProof()` function, and confirmed no blocking defect.
It raised one real, low-severity, actionable finding and two accepted
theoretical ones:

- **Fixed**: `rebindRepairedLaneProof()` resolved manifest-declared
  `model-routing.json` paths via a bare `path.resolve()` with no
  repo-root escape check, unlike `generateProofArtifacts()`'s
  `safeRepoPath()` guard for the same kind of manifest-declared path.
  `safeRepoPath` is now exported from `proof-generate.ts` and reused in
  `lane-close.ts`, with a new regression test proving an escaping path
  (e.g. `../../../../tmp/...`) is refused.
- **Accepted, not fixed**: `generateProofArtifacts()` binds only the
  first `model-routing.json` match (`.find()`) when a manifest declares
  more than one, while the fixed `rebindRepairedLaneProof()` binds every
  match (`.filter()`) -- a theoretical divergence, since no lane in
  practice declares more than one such sidecar, and changing
  `generateProofArtifacts()`'s own already-shipped behavior was judged
  outside this issue's authorized scope.
- **Accepted, not fixed**: the repair rollback transaction's whole-directory
  snapshot implicitly assumes every bound sidecar lives under
  `docs/06_status/proof/<issueId>/`, true under the sanctioned lane
  lifecycle but not independently enforced -- gated behind an
  already-abnormal manifest the sanctioned lifecycle does not produce.

The same review separately found a second, more severe defect while
mapping the actual replay path for UTV2-1585/UTV2-1586:
`post-merge-lane-close.yml`'s "Bind proof artifacts to merge SHA" step
runs on both `push` and `workflow_dispatch`, passing `github.sha` as
`--merge-sha`. `workflow_dispatch` is the *only* way to run the trusted
`--repair-merged` replay (a local shell can never satisfy
`isTrustedPostMergeAutomation()`), and on that trigger `github.sha` is
just main's current tip at dispatch time -- not the historical lane's
authoritative merge SHA. Because `model-routing.json`'s
`closeout_binding` is intentionally immutable-once-bound (unlike
`evidence.json`/`verification.md`'s last-write-wins rebind, which this
same step ordering never broke), this step would have bound
`model-routing.json` to the wrong SHA on any `workflow_dispatch` replay
attempt, and the immediately-following `--repair-merged` step's own
attempt to bind the real SHA would then fail closed with
`binding_conflict` -- permanently deadlocking the exact replay
UTV2-1585 and UTV2-1586 are queued for, the whole reason this issue
exists.

**PM authorized a second narrow scope amendment** adding
`.github/workflows/post-merge-lane-close.yml` to this issue. The "Bind
proof artifacts to merge SHA" step now runs on `push` events only
(`github.event_name == 'push'`); `--repair-merged`'s own
`rebindRepairedLaneProof()` (this issue's fix) already binds
`model-routing.json` authoritatively on the trusted repair path, so the
early bind is unneeded and actively harmful there. A regression test in
`scripts/ops/lane-close.test.ts` asserts the step's `if:` condition
requires `github.event_name == 'push'`. No trigger, permission, secret,
or job was added or removed; trusted-context validation
(`isTrustedPostMergeAutomation`) and Merge Gate/branch protection are
unchanged.

A second fresh-context independent Claude review of this workflow fix
(traced the full `main()` call graph, checked the real UTV2-1585/UTV2-1586
proof state still in the repo, inspected the `on:` block for any other
trigger this deadlock could still occur under, and tried to construct a
subtly-wrong condition that would still pass the new regression test)
found no blocking defect and confirmed the push case is genuinely
unaffected. It noted one accepted, currently-inert theoretical gap: the
now-skipped early bind step used to also *create* `diff-summary.md`/
`verification.md` from scratch via the full `ops:proof-generate` CLI when
missing entirely; `rebindRepairedLaneProof()`'s `rebindMergeSha()` only
rebinds those files if they already exist. Not a live issue -- both
UTV2-1585 and UTV2-1586 already have populated `evidence.json`/
`verification.md` in the repository today -- but documented in
`evidence.json`'s `known_limitations` for a future lane that reached a
`workflow_dispatch` replay having never had proof generated at all.

A fourth finding from the automated Codex reviewer: `rebindModelRoutingJsonSha`
accepted any required sidecar with a matching `issue_id`, regardless of
whether it carried real execution-provenance fields -- a truncated or
tampered sidecar such as `{"issue_id":"UTV2-1586"}` would receive an
authoritative `closeout_binding` despite providing no evidence of which
model actually executed the lane. Fixed by requiring non-empty `model`
and `reasoning_effort` string fields on any required sidecar, checked
after identity validation and before the existing conflict check.
Deliberately narrowed to these two fields (not also
`model_profile`/`policy_version`, which are administrative metadata
rather than execution provenance) so legitimate historical sidecars
that never carried the latter two are not rejected -- the real
UTV2-1585 and UTV2-1586 fixtures, and every existing sidecar fixture in
this test suite, already carry both required fields. Three new focused
tests cover a truncated `{issue_id}`-only sidecar, a sidecar with
`reasoning_effort` present but blank, and confirm optional (non-required)
sidecars remain unaffected.

A third fresh-context independent Claude review of this provenance-field
fix (traced every branch for a bypass via the existingBinding path,
confirmed both call sites share the identical validation with no drift,
ran the full 216-test suite plus type-check, and independently read the
real UTV2-1585/UTV2-1586 committed `model-routing.json` files plus all
17 such files in the repo) found no blocking defect and no bypass. It
noted two accepted, non-blocking items: the check requires `model`/
`reasoning_effort` to be non-empty but does not cross-check them
against the manifest's own identically-named `model_routing.model`/
`model_routing.reasoning_effort` fields (a well-formed but fabricated
value would still pass); and the existing UTV2-1585/UTV2-1586 fixture
tests synthesize an equivalent payload rather than reading the real
committed files directly (verified independently to still pass, not a
live regression). Both left as follow-up items rather than folded into
this already-multiply-amended PR.

## Fifth finding (fixed): the push-only restriction was incomplete

A further automated Codex review found the second scope amendment's
`github.event_name == 'push'` restriction did not cover every deadlock
path: a governed manifest-only repair PR (`buildRepairRequiredViaPrPacket`'s
recommended path for a lane whose `pr_url` is already set, e.g.
UTV2-1586) merges via an ordinary `push`, and that push's own
`github.sha` is the repair PR's own merge commit -- not the lane's
original implementation merge SHA -- even though `github.event_name ==
'push'` is true. The manifest checked out by that same push already
carries the correct historical `commit_sha` (the repair PR's whole
point), so the early bind step would still write the wrong SHA and hit
the identical `binding_conflict` deadlock later in the same run.

Fixed by additionally reading the checked-out manifest's own
`commit_sha` inside the step's script and skipping the early
`ops:proof-generate` bind whenever it already disagrees with this
push's SHA -- the signal that this push is a repair commit, not the
lane's own first-time closeout. A regression test in
`scripts/ops/lane-close.test.ts` asserts the guard is present and that
the `pnpm ops:proof-generate` call is gated behind it (inside the
`else` branch), not run unconditionally alongside it.

## Final consolidated review

A sixth, final fresh-context independent Claude review did a
from-scratch adversarial pass over the entire diff, specifically
hunting for a sixth variant of the deadlock class the five prior fixes
addressed: a bot-actor self-retrigger, a stale-but-coincidentally-matching
`commit_sha`, concurrent/overlapping workflow runs, and interaction
between the new guards and the workflow's other two safety steps (the
tracked-changes scope guard and the commit/push step). It ran the full
261-test suite, `pnpm type-check`, and `pnpm lint`, and confirmed the
diff's scope is exactly the claimed files with no changes to
`truth-check-lib.ts`, `merge-gate.yml`, or `docs/governance/`. It found
no blocking issue and no further deadlock variant: every path traced
either resolves safely by design (`repairMergedLaneManifest()` always
re-resolves the authoritative PR/SHA from GitHub before any write, and
nothing reaches `main` unless `ops:lane-close` exits 0) or reduces to
an already-known, differently-classified failure (`infra_error` for a
still-null `pr_url`). It flagged one wording-only nitpick in the
workflow comment, fixed in a comment-only follow-up commit with no
behavior change.

See `docs/06_status/proof/UTV2-1589/evidence.json`'s `known_limitations`
for the full text of each finding across all six review rounds.

EVIDENCE:

## Verification

The following commands were executed on substantive commit
`0861755aa7806c9bed312731854dab9f94800aa0`:

- `npx tsx --test scripts/ops/proof-generate.test.ts scripts/ops/truth-check-lib.test.ts scripts/ops/lane-close.test.ts`
- `npx tsx --test scripts/ops/workflow-hardening.test.ts`
- `pnpm type-check`
- `pnpm test`
- `pnpm test:db`
- `pnpm test:t1-proof:live`
- `pnpm verify`
- `npx tsx scripts/ops/lane-manifest.ts validate UTV2-1589 --json`
- `git diff --check`
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`

```text
Focused proof generation and truth checks
# tests 217
# pass 217
# fail 0
# skipped 0

Existing workflow-hardening suite (unaffected)
# tests 44
# pass 44
# fail 0
# skipped 0

Live database smoke
# tests 7
# pass 7
# fail 0
# skipped 0

pnpm verify
exit 0

Manifest validation
{"ok":true,"code":"manifest_valid","errors":[]}

diff-check
exit 0

R-level
Verdict: PASS
Changed files: 10
Rules matched: (none)
```

The broader T1 live-proof battery completed with zero failures. One bounded
provider-history assertion skipped because the latest provider snapshot was
older than its lookback window; the test classifies that as stale provider
data, not a code regression. It also reported 196 pre-existing stranded
`awaiting_approval` rows. This lane did not update, delete, or backfill those
rows.

## Historical repair impact inventory

| Issue | Current state | Authoritative merge identity | Required recovery |
|---|---|---|---|
| UTV2-1585 | `started`; sidecar lacks binding | PR #1305 / `97527b791fc37acce41f4f46fd88699dce054b66` | Replay trusted post-merge closeout with explicit PR #1305 after UTV2-1589 merges |
| UTV2-1586 | `in_review`; sidecar lacks binding | PR #1306 / `fe09f637a7eeebf216e062dd4a003d7e38932d1a` | Replay trusted post-merge closeout using its recorded PR after UTV2-1589 merges |
| UTV2-1589 | `started`; active premerge lane | Pending implementation PR | Close normally through the repaired path after merge |

A pre-replay audit against every current truth-check requirement (Linear
state, PR/merge identity, declared implementation files, evidence
structure, verifier independence, sync/lease/worktree state) found no
blocker for either UTV2-1585 or UTV2-1586 other than the model-routing.json
SHA-binding gap this PR closes; both replays are expected to succeed once
this PR merges. R1-R3 (live Supabase row-count assertions) were not
statically verifiable and remain to be confirmed by the actual replay run.

The candidate inventory is intentionally narrow: Codex T1 manifests that are
not done and declare a `model-routing.json` proof. UTV2-1585 and UTV2-1586 are
the two historical repair candidates. UTV2-1589 is the active implementation
lane and is not a historical replay candidate.

## Merge SHA Binding

The value above is the substantive premerge commit used for verification.
Trusted post-merge proof generation must replace it with the authoritative
GitHub merge SHA and append the matching `closeout_binding` to
`model-routing.json`.

This is executor-produced evidence for independent review. It is not a PM
verdict, does not add `t1-approved`, and does not authorize merge.
