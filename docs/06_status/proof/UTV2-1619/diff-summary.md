# UTV2-1619 diff summary — bootstrap governance identity support

MERGE_SHA: <pending — bound post-merge by post-merge-lane-close.yml>

- `scripts/ops/bootstrap-authorization.ts`: recognition now runs in a fixed order —
  active lane identity, then explicit bootstrap intent, then authority. The first two
  steps precede any read of the authorization file, which is what keeps a malformed or
  duplicated grant invisible to PRs that never claimed bootstrap identity. Lane identity
  is resolved with `readTrustedLaneManifest` (base content, or the first commit that
  added a branch-introduced manifest) against the same active-status set
  `file-scope-guard.ts` uses, so the two can no longer disagree. Intent is derived from
  the `bootstrap/` branch namespace inside the resolver rather than asserted by a caller
  flag. Branch/title/commit binding moved here from the PR-head guard. Exit codes are now
  meaningful: `0` valid, `2` usage, `3` recognized-and-refused, `4` not a bootstrap
  action — and the decision file is always written, so no consumer can read a stale one.
- `scripts/ci/file-scope-guard.ts`: `loadBootstrapAction` refuses any decision path that
  resolves inside the repository root, and refuses wildcard `allowed_scope` entries. Both
  are exported for direct testing.
- `scripts/ops/branch-discipline-guard.ts`: reverted to the base-branch copy. It holds no
  bootstrap logic at all; the workflow runs it only when the trusted resolver has already
  said the PR is not a bootstrap action. Its path is correspondingly gone from the
  resolver's fixed bootstrap scope: the lane no longer touches the file, and a standing
  permission with nothing behind it is a permission worth removing.
- `scripts/ops/pr-review-packet.ts`: renders a bootstrap packet but never authorizes one;
  decision loading gained the outside-the-checkout requirement.
  `sameIssueLaneMetadataPaths` now includes the lane's own proof directory, matching the
  unconditional grant `file-scope-guard.ts` has made since UTV2-1518 — the two scope views
  previously disagreed, and a lane's own admission receipt fell in the gap.
- Three workflows (`branch-discipline-guard`, `file-scope-lock-check`,
  `return-review-packet`): resolver and decision both live in `$RUNNER_TEMP`; stale files
  are removed before resolution; `continue-on-error` is gone; the base resolver is probed
  for `--resolve-action` support and grants nothing when it is absent; exit codes gate
  what runs next.
- `scripts/ops/bootstrap-identity-e2e.test.ts` (new): 19 end-to-end tests over real git
  fixtures, covering all eight required behaviors plus expiry and scope violations.
- `scripts/ops/bootstrap-authorization.test.ts`: duplicate `BGA-6/7/8` identifiers
  resolved; branch-discipline-coupled tests replaced with binding and transport tests;
  added coverage for recognition ordering, the active-status set, and intent derivation.
- `docs/06_status/lanes/UTV2-1619.json`: `file_scope_lock` restored to include the lane's
  own control-plane and proof paths, plus the new test file and `package.json`.
- `docs/06_status/proof/UTV2-1619/model-routing.json`: the routing field is named
  `model_profile`, the key `proof-generate.ts` actually matches against the manifest's
  `model_routing.profile`. Under the previous name the field was simply absent as far as
  the validator was concerned, and `OPTIONALLY_MATCHED_ROUTING_FIELDS` skipped the
  comparison rather than failing it — a check that could not fail was not a check.
