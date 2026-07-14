# UTV2-1532 Verification

**Commit SHA:** bee05f79b29f1c93cb82696f48f73cf3a8f65ecf (this proof commit's parent — exact HEAD SHA cannot be embedded pre-commit; temporal binding closes the gap per the gate's own advisory note, and `post-merge-lane-close.yml` rebinds to the merge SHA automatically after merge)

## Verification

- `npx tsx --test scripts/ops/codex-exec.test.ts` — PASS (13 tests), including the new no-upstream first-push regression case.
- `pnpm type-check` — PASS.
- `pnpm test` — PASS.
- `pnpm verify` — PASS.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS; no R1–R5 rules matched.
- `pnpm test:db` — PASS (7/7), required unconditionally by `proof-auditor-gate.ts` regardless of tier:

```
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

This T2 fix does not touch runtime DB code — `pnpm test:db` is run only to satisfy the Proof Auditor Gate's blanket `--require-executed-command "pnpm test:db"` check, not because this diff has DB-facing behavior.

The focused regression creates a bare origin, pushes `main`, switches to a new untracked `codex/...` branch, persists evidence, and verifies both the fresh remote clone and `origin/codex/...` upstream relationship.
