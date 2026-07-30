# PROOF: UTV2-1553
MERGE_SHA: 016cca65bc86a18d336c08cf1a0e834a3381bda9

ASSERTIONS:
- [x] Both target lanes are proven merged on GitHub before any state change
- [x] Both manifests transition to the canonical non-active `merged` status
- [x] `merged` is excluded from ACTIVE_LOCK_STATUSES, so capacity slots and the package.json file lock are released by definition, not by exception
- [x] Neither lane is marked done
- [x] No truth-check history is appended or synthesized — 0 entries before and after, asserted programmatically during the edit
- [x] No implementation proof is altered and no terminal closeout is claimed
- [x] The open reconciliation PR's branch and head are untouched
- [x] Runtime proof executed against the staging Supabase project, never production

EVIDENCE:

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

T1 preflight, zero waivers:

```text
VERDICT: PASS (41 checks)
| PT1 | PASS | Supabase service role credential validated via read health ping |
| PB2 | PASS | pnpm test passed after full-verify throttle slot 1/1 |
```

Runtime proof — `pnpm test:db` against staging project xskgrzbteyqdufktjrjx,
never production zfzdnfwdarxucxtaojxm:

```text
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 27615.21783
```
