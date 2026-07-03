# UTV2-1401 Verification

## Verification

Commands run from `/home/griff843/code/Unit-Talk-v2/.out/worktrees/griffadavi__utv2-1401-ops-harness-hardening-batch` after merging all fix commits together:

- `pnpm lint` — pass
- `pnpm type-check` — pass
- `pnpm build` — pass
- `pnpm test` — pass, all suites green (739+ tests across the full matrix, 0 failures)
- `pnpm ops:preflight UTV2-1401 --tier T2 --branch griffadavi/utv2-1401-ops-harness-hardening-batch --files ...` — VERDICT: PASS (40 checks)
- `pnpm lane:check --lane governance --base origin/main --head HEAD` — `lane:check PASS lane=governance files=20`

### Full `pnpm test` summary

```
# tests 739
# suites 6
# pass 739
# fail 0
# cancelled 0
# skipped 0
# todo 0
```
(plus the remaining workspace test scripts chained by `pnpm test`, all reporting `# fail 0`.)

### `scripts/ops/ops-merge-wrapper.test.ts` TAP output (post-fix)

```
1..23
# tests 23
# suites 0
# pass 23
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

### `scripts/ops/merge-wrapper.test.ts` TAP output

```
1..10
# tests 10
# suites 0
# pass 10
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Issue-specific proof:

- **Autostash fix (`main-sync`) verified live, not just in tests**: ran `pnpm ops:merge-wrapper main-sync --issue UTV2-1401 --branch griffadavi/utv2-1401-ops-harness-hardening-batch` against a real divergent branch (10 commits behind origin/main). Result: `{"ok":true,"code":"merge_wrapper_completed", ...}`, stderr showed `Rebasing (1/10)` through `(10/10)`, `Successfully rebased and updated refs/heads/...`. Confirms the ff-only→rebase fallback and autostash bookkeeping work end-to-end against real git state, not just mocked runners.
- **Hook stderr routing verified live** for `bash-safety-guard.sh` and `pre-proof-validator.sh`: piped a triggering payload on stdin and confirmed the failure message appears on stderr with stdout empty (`exit=2`), and the passing case has both streams empty (`exit=0`).
- **BOM fail-closed verified live**: `pnpm env:check` initially caught a real BOM in `.env.example` during development (`... has a UTF-8 BOM at byte 0 — re-save the file without a BOM ...`, exit 1) before the BOM was stripped, then passed clean afterward.
- **Integration regression caught and fixed during this same lane**: after merging all five independent fixes onto one branch, the full suite surfaced 7 failing tests in `ops-merge-wrapper.test.ts` caused by an interaction between the new `main-sync` autostash (item 5 in the PR description) and `git-merge-main`/`git-rebase-main`'s pre-existing `interceptingRunner` command-substitution bridge, which blindly replaced every runner call with the merge/rebase command — in production this would have silently replayed the merge/rebase command 3x instead of stash→command→stash-pop. Root-caused and fixed in `scripts/ops/ops-merge-wrapper.ts` (commit `7114a18a`/replayed as `4f93963a`); each fix's own isolated test suite had passed, only the combined suite exposed it.
- No runtime, lifecycle, contract, or migration files touched — this lane is tooling/harness/docs only (`.claude/hooks/**`, `CLAUDE.md`, `docs/05_operations/**`, `scripts/**`, `package.json`, `.env.example`), matching the `governance` lane contract and `tier:T2` ("Additive. No migration. No settlement/promotion path change.").

## Merge SHA

_To be filled in by `ops:lane-close --repair-merged` after merge (per the updated `CLAUDE.md` guidance this lane itself adds)._

Anticipated at merge time: two repo-wide, content-independent gates may still be red and unrelated to this lane's diff, consistent with the precedent set by UTV2-1382's `verification.md`:
- **Readiness Regression Gate** — main's `readiness-score.json` ledger is stale (>48h threshold as of this lane); not a required branch-protection status check, and not something a T2 tooling/harness PR should regenerate out-of-scope.
- **Live Schema Parity** — pre-existing migration-ledger drift unrelated to this lane (no migration files touched).
