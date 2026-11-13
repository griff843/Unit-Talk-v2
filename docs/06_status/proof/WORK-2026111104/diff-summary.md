# Diff summary: WORK-2026111104

Code commit: `f655fc5c553b558419e00b9cd50227b98ad15458` (on `main` `328b71064`).

| File | Change |
|---|---|
| `scripts/ops/shared.ts` | `issueIdFromBranchName` now builds its pattern from `ISSUE_ID_NAMESPACES` (UTV2, UNI, WORK) instead of hard-coding `utv2\|uni`. The skip reason in `resolveActiveLaneManifests` is derived from the same list. No other behavior changes. |
| `scripts/ops/shared.test.ts` | Three tests: WORK branch parsing (and non-lane branches still `null`), a WORK lane whose manifest exists only on its PR head is discovered and its lock overlaps, and an unreadable WORK manifest raises `ActiveLaneDiscoveryError`. |
| `.ops/work/WORK-2026111104.md` | Repo-owned work order. |
| `docs/06_status/proof/WORK-2026111104/*` | This proof. |

Lane metadata (`docs/06_status/lanes/WORK-2026111104.json`, `.ops/sync/WORK-2026111104.yml`) was written by `ops:lane-start`.

## Effect

Before: every open `<owner>/work-<n>-<slug>` PR was skipped by open-PR lock discovery, so its `file_scope_lock` was enforced only by the local lease registry and manifests of the checkout that started it.

After: WORK lane PRs go through the same path as UTV2/UNI lanes. A manifest read that throws for a WORK branch is now fail-closed (`ActiveLaneDiscoveryError`) instead of silently skipped.

Rollout note: on merge, the locks of currently open WORK lane PRs become enforced for every `ops:lane-start`. Measured 2026-11-12, that adds 8 WORK lanes (#1738, #1771, #1772, #1776, #1778, #1833, #1841, #1842) to the visible set. #1776 locks `package.json`; #1842 locks `merge-gate.yml` and five other workflows.

## SHA Binding

Merge SHA: e72318d5fd3bad21934167c3a4584014ea58ba82
PR: pending
