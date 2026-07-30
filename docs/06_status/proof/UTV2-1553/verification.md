# PROOF: UTV2-1553
MERGE_SHA: 2ca54dd158364c954d184e7768f355e67195d08b

## Summary

Two lanes were merged on GitHub but their manifests still declared an active
status, so they continued to hold concurrency capacity and the `package.json`
file-scope lock. This lane moves both manifests to the canonical `merged`
status. It changes lane accounting only: no implementation file, no proof
bundle, and no terminal closeout is touched.

`merged` is not a member of `ACTIVE_LOCK_STATUSES`, so the capacity slot and the
file lock are released *by definition* rather than by an exception or an
override.

ASSERTIONS:
- [x] Both target lanes are proven merged on GitHub before any state change
- [x] Both manifests transition to the canonical non-active `merged` status
- [x] `merged` is excluded from ACTIVE_LOCK_STATUSES, so capacity slots and the package.json file lock are released by definition, not by exception
- [x] Neither lane is marked done
- [x] No truth-check history is appended or synthesized — 0 entries before and after, asserted programmatically during the edit
- [x] No implementation proof is altered and no terminal closeout is claimed
- [x] The open reconciliation PR's branch and head are untouched
- [x] This lane makes no writable database claim; it changes JSON manifest state only

## Verification

Static verification only, which is the whole verification surface this change
has. The diff is four JSON manifests and one sync file.

```text
pnpm type-check   PASS
pnpm lint         PASS
```

There is deliberately **no writable-database claim in this document.** Under
UTV2-1630 a writable DB claim can only be satisfied by a `ci-db-proof-receipt/v2`
artifact produced by the `staging-db-proof` job and verified inside the required
`verify` context. Proof-file text is never sufficient, so asserting one here
would be both unnecessary for a manifest-only change and unverifiable.

## Evidence

Merge proof from GitHub (authoritative):

```text
PR#1313  MERGED  mergedAt=2026-07-28T13:18:52Z  mergeSha=2822b709c74c43dc24a50dc6df35597e1a0463fe
PR#1305  MERGED  mergedAt=2026-07-24T16:40:22Z  mergeSha=97527b791fc37acce41f4f46fd88699dce054b66
```

Manifest transitions, state only:

```text
UTV2-1612  in_review -> merged   truth_check_history 0 -> 0
UTV2-1585  started   -> merged   truth_check_history 0 -> 0
```

Canonical definition that makes this a release rather than an exception:

```text
scripts/ops/shared.ts
export const ACTIVE_LOCK_STATUSES = new Set<LaneManifestStatus>([
  'started', 'in_progress', 'in_review', 'blocked', 'reopened',
]);
// 'merged' is absent
```

T1 preflight, zero waivers — the first T1 preflight in this program to validate
its Supabase credential against staging rather than production:

```text
VERDICT: PASS (41 checks)
| PT1 | PASS | Supabase service role credential validated via read health ping (staging xskgrzbteyqdufktjrjx) |
| PB2 | PASS | pnpm test passed after full-verify throttle slot 1/1 |
```

## Delivery path

This PR is stacked on `claude/utv2-1630-isolated-proof-execution` rather than on
`main`, and is squashed into that branch instead of merging separately.

The reason is a circular dependency that caused real harm. UTV2-1630 removes
production credentials from CI, but it could not merge while this ghost lock
held `package.json`. This branch previously targeted `main`, so every push ran
`main`'s unguarded `ci.yml` — which wrote 1,036 picks and 943 submissions into
the production database across 2026-07-29 and 2026-07-30. Unblocking the
production-safety fix was itself writing to production.

Rebasing onto the UTV2-1630 branch makes this PR inherit the staging-only
workflows, so the repair can land without another production write. The full
record of this repair is preserved in PR #1322, in Linear, and in the
`scope_transfers` block of `docs/06_status/lanes/UTV2-1630.json`.
