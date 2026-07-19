# PROOF: UTV2-1553

MERGE_SHA: set-by-ci

(This is a narrow bug fix, not the full scope of UTV2-1553's parent issue --
see diff-summary.md for how this relates to the broader post-merge-closeout
capacity work tracked there.)

## Summary

Found while reconciling UTV2-1543's terminal close (PR #1260): a real bug in
`scripts/ops/lane-close.ts`'s normal (non-`--repair-merged`) close path.
`runTruthCheck()` persists its own updated manifest to disk (with the
passing `truth_check_history` entry appended) as a side effect of running.
The caller in `main()` held an in-memory `manifest` snapshot taken *before*
that call and wrote it back verbatim after setting `status: 'done'`,
silently clobbering the just-persisted history entry. The net effect: a
lane could close successfully (status: done, closed_at set) while its
persisted `truth_check_history` array's last entry was a stale prior
failure, not the passing check that actually authorized the close.

## Fix

Extracted the terminal-close mutation into `finalizeLaneCloseManifest()`,
which re-reads the manifest from disk (picking up `runTruthCheck()`'s fresh
write) before applying `status`/`closed_at`/`heartbeat_at` and writing back.

## ASSERTIONS:

- [x] `finalizeLaneCloseManifest` re-reads from disk before mutating, so a `runTruthCheck()`-persisted history entry survives
- [x] Regression test reproduces the exact bug pattern and fails against the old inline code, passes against the fix
- [x] `main()`'s close path now calls the extracted, tested function instead of inline stale-state logic
- [x] No behavior change to any other code path (`--repair-merged`, lock acquisition, lease release, error handling all untouched)
- [x] pnpm verify PASS (see EVIDENCE below)
- [x] scripts/ops/lane-close.test.ts: 65/65 PASS, including the new regression test

## EVIDENCE:

```text
$ pnpm exec tsx --test scripts/ops/lane-close.test.ts
1..65
# tests 65
# pass 65
# fail 0
# cancelled 0
# skipped 0
```

```text
$ pnpm verify
(exit 0 -- full static gate + live DB smoke + live T1 proof suite)
```

## Owner boundary

T2 -- ops-scripts bug fix, no runtime/production behavior touched, no
migration, no policy change. GitHub PR review approval or a pm-verdict/v1
comment satisfies merge authority per the standing T2 rule.
