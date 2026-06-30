# UTV2-1388 Verification — Create docs/START_HERE.md Agent Onboarding Doc

## Summary

Created `docs/START_HERE.md` as the canonical 10-minute onboarding document for agents starting
a new Unit Talk V2 session. Updated `docs/05_operations/docs_authority_map.md` to reference it,
and added a pointer in `docs/CODEBASE_GUIDE.md`.

**Branch:** `claude/utv2-1388-start-here-docs`
**Branch HEAD SHA:** `8d4fa696`
**Merge SHA:** `9ed134b5dbf061b2eb756d7366693cb0429e32f7`
**Executor:** Claude (claude-sonnet-4-6)
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/1123

## Evidence

### pnpm verify:quick

```
pnpm verify:quick
```

Result: PASS — sync-check, system-alignment, automation-coverage, env:check, lint, type-check all green.

### R-level compliance

```
Verdict: PASS
Changed files: 4
Rules matched: (none) — no R-level artifacts required for pure-docs diff
```

### Lane authority

Fixed governance lane to allow `docs/START_HERE.md` and `docs/CODEBASE_GUIDE.md` (added to
`.lane/lanes/governance.yml` allowed_path_globs).

## Verification

**Verdict: PASS**

All CI gates green on merge SHA:
- Lane authority: PASS
- File scope lock: PASS
- Check issue references: PASS
- R-Level Compliance Check: PASS
- Merge Gate: PASS
- verify: PASS
