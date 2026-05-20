# UTV2-1081 — Diff Summary

**Branch:** claude/utv2-1081-fix-codex-exec-ts  
**Issue:** Fix codex-exec.ts — replace invalid `codex run --prompt-file` with `codex exec`

## Summary

### scripts/ops/codex-exec.ts
- Removed temp `.codex-prompt.md` file write (lines ~163-165 in original)
- Changed spawn args from `['run', '--prompt-file', promptFile]` to `['exec', prompt]`  
- Removed temp file cleanup block
- Added `checkExecSubcommand()` pre-flight that runs `codex exec --help` and fails fast if the `exec` subcommand is missing (guard against future CLI drift)
- No changes to dry-run path (still reports correctly)

### scripts/ops/codex-health-check.ts
- No changes required — only checks `codex --version`, no reference to `run` subcommand

## Files changed
- `scripts/ops/codex-exec.ts` — 3 deletions, ~15 additions (checkExecSubcommand + exec call)

## Verification
`codex run --prompt-file` is not a valid command in `codex-cli 0.131.0`. Correct API is `codex exec <PROMPT>`. This caused all Codex dispatch attempts to fall back to Claude silently.
