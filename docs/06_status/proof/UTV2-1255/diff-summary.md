# UTV2-1255 — Diff Summary

## Scope

`.github/workflows/deploy.yml` only (governance lane, singleton-approved). No runtime app code changes.

## Change

Two occurrences (deploy job line ~233, second job line ~382) of the bash default-expansion bug:

```bash
# before — bash ends the expansion at the FIRST `}`, so an empty secret yields `{}}` (invalid JSON)
_target_map="${UNIT_TALK_DISCORD_TARGET_MAP:-{}}"

# after — safe default
_target_map="${UNIT_TALK_DISCORD_TARGET_MAP:-}"
[ -z "$_target_map" ] && _target_map='{}'
```

## Why

When the `UNIT_TALK_DISCORD_TARGET_MAP` secret is empty/unset, the old pattern wrote
`UNIT_TALK_DISCORD_TARGET_MAP={}}` into `/opt/unit-talk/.env.production`. The worker's
fail-closed `readDiscordTargetMap` (`apps/worker/src/runtime.ts`) throws on `JSON.parse`
at boot, crash-looping the worker after every deploy (observed: ~21h outage 2026-06-10,
recurrence after the 2026-06-11 02:38Z deploy of `fb07846a`).

## Pattern audit

`grep -rn ':-{}' .github/workflows/ scripts/` — only these two occurrences existed; both fixed.
