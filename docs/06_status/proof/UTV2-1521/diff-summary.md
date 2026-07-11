# UTV2-1521 Diff Summary

Issue: UTV2-1521
Tier: T1
Branch: claude/utv2-1521-authenticate-scope-override
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1191

## Summary

Removes the manifest-embedded `scope_override` field from the file-scope guard — any PR could self-grant its own scope widening since the override lived inside the same JSON the PR's diff controls. Replaces it with an externally-authored PR comment (`scope-override/v1`) authenticated the same way `merge-gate.yml` authenticates its self-attestation schemas, bound to issue ID + PR number + head SHA so it can't be forged or carried across a push.

## Files changed

```
.github/workflows/file-scope-lock-check.yml     |  93 ++++++++++-
docs/05_operations/schemas/scope-override-v1.md |  70 +++++++++
scripts/ci/file-scope-guard.test.ts             | 179 ++++++++++++++++-----
scripts/ci/file-scope-guard.ts                  | 200 +++++++++++++++++++-----
scripts/ops/merge-risk.ts                       |   6 +
5 files changed, 460 insertions(+), 88 deletions(-)
```

- `scripts/ci/file-scope-guard.ts` — removes `ScopeOverride`/`isWellFormedScopeOverride` and the manifest-embedded-override-honoring branch in `resolveTrustedManifests`. Adds `ExternalScopeOverride`, `isWellFormedExternalOverride`, `resolveApplicableOverride(overrides, context)` (exact match on issue_id/pr_number/head_sha, fails closed on any mismatch), `loadExternalOverrides`. Adds `--override-file`/`--pr-number`/`--head-sha` CLI args (also readable via env vars). `fileIsAllowedByOwnManifest` and `evaluateFileScopeGuard` take the applicable override, scoped only to the PR's own manifest.
- `scripts/ci/file-scope-guard.test.ts` — removes 2 obsolete tests for the old mechanism, adds 1 regression test (manifest-embedded override never honored) + 5 new authorization scenario tests (self-authored/wrong-PR, stale head-SHA, wrong-issue, wrong-PR, valid-accept, cross-lane-leak-prevention).
- `docs/05_operations/schemas/scope-override-v1.md` — new schema doc for the `SCOPE_OVERRIDE: APPROVED` / `schema: scope-override/v1` PR comment format.
- `.github/workflows/file-scope-lock-check.yml` — collects authorized `scope-override/v1` comments via `actions/github-script`, authenticated against `AUTHORIZED_REVIEWERS`, writes validated matches to `.out/scope-overrides.json`. Wires `--override-file`/`--pr-number`/`--head-sha` into the guard invocation, but only when the *trusted* (base-branch) copy of the guard script supports those flags — the trusted copy is main's until this PR merges, so the new flags are detected via a grep-based capability check rather than passed unconditionally (fixes a self-inflicted bootstrapping failure found while opening this PR).
- `scripts/ops/merge-risk.ts` — adds `scripts/ci/file-scope-guard.ts` and its test to `TIER_C_EXACT_PATHS` as self-protection.

## Verification
See `docs/06_status/proof/UTV2-1521/verification.md` for full command output, including the live-DB smoke required for T1.
