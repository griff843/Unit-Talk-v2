# UTV2-1553 — Verification

**Source head:** `016cca65bc86a18d336c08cf1a0e834a3381bda9`
**Tier:** T1 · **Lane type:** governance

## Summary

State-only release of two merged lanes from active capacity and file-lock
accounting. Two manifests transition to `merged`. No code, no closeout, no
truth-check history.

## Evidence

Merge proof (GitHub, authoritative):

```
PR#1313  MERGED  2026-07-28T13:18:52Z  mergeSha=2822b709c74c43dc24a50dc6df35597e1a0463fe
PR#1305  MERGED  2026-07-24T16:40:22Z  mergeSha=97527b791fc37acce41f4f46fd88699dce054b66
```

Manifest transitions, state only:

```
UTV2-1612  in_review -> merged   truth_check_history 0 -> 0
UTV2-1585  started   -> merged   truth_check_history 0 -> 0
```

`merged` is excluded from `ACTIVE_LOCK_STATUSES` in `scripts/ops/shared.ts`, and
`scripts/ci/file-scope-guard.ts` documents the same rule for conflict-blocking,
so both lanes release their capacity slots and the file lock by the repository's
canonical definition rather than by exception.

## Verification

T1 preflight: **PASS, 41 checks, zero waivers.**

`pnpm test:db` executed against the **staging** Supabase project
`xskgrzbteyqdufktjrjx` — never production `zfzdnfwdarxucxtaojxm`:

```
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 27615.21783
```

Static verification: `pnpm verify:quick` via preflight PX1; `pnpm test` via
preflight PB2, both PASS.

Deliberately not done: neither lane marked `done`; no truth-check history
appended or synthesized (asserted programmatically during the edit); no
implementation proof altered; no terminal closeout claimed; the open
reconciliation PR untouched.
