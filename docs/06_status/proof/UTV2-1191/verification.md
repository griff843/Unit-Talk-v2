# Verification - UTV2-1191

## Summary

UTV2-1191 enforces markdown proof artifacts by blocking changed `verification.log` files in the proof auditor workflow. The scoped historical proof directories now have `verification.md` files that the proof gates can read.

## Verification

- `pnpm type-check` - PASS.
- `pnpm test` - PASS.
- `pnpm verify` - PASS. Final command block verified smart-form tests and command manifests:

```text
[command-manifest] Verified 14 command definition(s) against apps/discord-bot/command-manifest.json
[check-migration-versions] 114 migration file(s) verified - no duplicate versions.
[lint-migrations] 114 migration file(s) checked - no findings.
```

- `node --import tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` - PASS.

```text
Verdict: PASS
Changed files: 0
Rules matched: (none) - no R-level artifacts required for this diff
```

- Proof artifact section audit - PASS.

```text
all listed verification.md files exist with ## Verification
```

- Proof auditor gate over all listed proof directories - PASS for each UTV2 proof directory in scope.
- `verification.log` detection check - PASS.

```text
verification.log pattern rejected
docs/06_status/proof/UTV2-1191/verification.log
```

## Environment Notes

- `pnpm exec tsx` and `npx tsx` hit an IPC socket `EPERM` in this sandbox for direct script execution. Equivalent checks were run with `node --import tsx`.
- The worktree branch had unrelated commits before this lane's edits, and git ref writes were denied by the sandbox. PR creation and tier labeling were not performed from this session.
