# UTV2-1255 — Verification

## Verification

### Expansion behavior proof (bash semantics)

```bash
$ UNIT_TALK_DISCORD_TARGET_MAP=""; _target_map="${UNIT_TALK_DISCORD_TARGET_MAP:-}"; [ -z "$_target_map" ] && _target_map='{}'; echo "$_target_map"
{}
$ echo "$_target_map" | python3 -m json.tool >/dev/null && echo VALID_JSON
VALID_JSON
```

Old pattern reproduction (the bug):

```bash
$ unset UNIT_TALK_DISCORD_TARGET_MAP; echo "${UNIT_TALK_DISCORD_TARGET_MAP:-{}}"
{}}
```

### Runtime evidence (production truth)

- 2026-06-10 ~05:30Z deploy stamped `UNIT_TALK_DISCORD_TARGET_MAP={}}` into `/opt/unit-talk/.env.production:21`; worker crash-looped (641+ restarts, `JSON.parse` SyntaxError at `apps/worker/src/runtime.ts:299`).
- 2026-06-11 02:38Z deploy of `fb07846a` re-stamped the same malformed value — confirming the workflow, not the host file, is the source.
- Host hotfix to `{}` + force-recreate → `worker.startup` clean, container healthy. The workflow fix makes the hotfix permanent.

### Live-DB smoke (`pnpm test:db`)

```text
$ pnpm test:db
# tests 7
# pass 7
# fail 0
# cancelled 0
# skipped 0
```

Run against real Supabase (project zfzdnfwdarxucxtaojxm) from the lane worktree on 2026-06-11.

### Checks

- `pnpm verify` on the lane branch — see PR checks (CI is the binding record).
- `grep -rn ':-{}' .github/workflows/ scripts/` → zero remaining occurrences post-fix.

## Post-merge SHA binding

Merge SHA: e5634c9878b185bb18965b182a70f97cfa6258d1 (PR #1007, squash, merged on green)

- `pnpm type-check` — PASS (preflight PB1 + CI verify on branch head)
- `pnpm test` — PASS (preflight PB2 + CI verify on branch head)
- `pnpm verify` — green via required CI check on PR #1007
- `scripts/ci/r-level-check.ts` — R-Level Compliance Check ✓ PASSED on PR #1007
