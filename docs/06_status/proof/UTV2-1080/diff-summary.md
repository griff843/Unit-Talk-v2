# Diff Summary — UTV2-1080

**Merge SHA:** `60e7e9955eeab666942620de2cde55365f935a6c`

## Changes

### scripts/ops/lane-close.ts
- Changed `acquireLock` option default: was `bools.has('acquire-lock')` (opt-in), now `!bools.has('no-acquire-lock')` (opt-out)
- Updated remediation message to reference `--no-acquire-lock` flag for skipping auto-acquire
- Merge lock is now automatically acquired during lane close unless `--no-acquire-lock` is passed

### .claude/commands/dispatch.md
- Updated dispatch skill to document the new auto-acquire behavior in lane close flow
