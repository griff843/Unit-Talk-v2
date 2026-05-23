# UTV2-1084 Verification

Issue: UTV2-1084
PR: https://github.com/griff843/Unit-Talk-v2/pull/831
Worktree: /tmp/utv2-pr831
Verified at: 2026-05-23

## Verification

```bash
tsx --test scripts/ci/schema-roundtrip-hash.test.ts scripts/ci/migration-reversibility-gate.test.ts
```

Result: PASS

Evidence:

```text
# tests 8
# pass 8
# fail 0
```

```bash
pnpm verify
```

Result: PASS

Evidence:

```text
> unit-talk-v2@0.1.0 verify /tmp/utv2-pr831
> pnpm env:check && pnpm lint && pnpm type-check && pnpm build && pnpm test && pnpm smart-form:verify && pnpm verify:commands

[command-manifest] Verified 14 command definition(s) in /tmp/utv2-pr831/docs/06_status/commands/command-manifest.json.
[check-migration-versions] 108 migration file(s) verified — no duplicate versions.
[lint-migrations] 108 migration file(s) checked — no findings.
```

Note: the first isolated worktree `pnpm verify` attempt failed before tests because `local.env` was not present in `/tmp/utv2-pr831`. The worktree was linked to the existing local environment file and `pnpm verify` was rerun successfully.

## CI Fix Coverage

- `schema-roundtrip-hash.ts` now strips volatile pg_dump `\restrict` and `\unrestrict` guard lines before hashing schema dumps.
- `schema-roundtrip-hash.test.ts` proves two equivalent dumps with different pg_dump guard tokens normalize to the same canonical schema text.
- `migration-reversibility-gate.yml` now invokes `grep -q -- '-- IRREVERSIBLE:' "$DOWN"` so the sentinel check cannot be parsed as an option.
