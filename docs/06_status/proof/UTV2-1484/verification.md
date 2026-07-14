# PROOF: UTV2-1484
MERGE_SHA: 484c25bdf07173b902ee178312b7560f3e530a1d

ASSERTIONS:
- [x] Read-only API surface only, no write handlers
- [x] Command Center UI labels missing data clearly
- [x] pnpm verify and pnpm test:db are green

EVIDENCE:
```text
$ npx tsx --test apps/command-center/src/app/api/governance/lanes/route.test.ts
# pass 2
# fail 0
```

# UTV2-1484 Verification

**Commit SHA:** 752ac10e4e03d1b464bbc39d91bd5569637d9e55 (this proof commit's parent — exact HEAD SHA cannot be embedded pre-commit; `post-merge-lane-close.yml` rebinds to the merge SHA automatically after merge)

## Verification

- `npx tsx --test apps/command-center/src/app/api/governance/lanes/route.test.ts` — PASS (2 tests).
- `pnpm test:command-center` — PASS (116 tests).
- `pnpm type-check` — PASS.
- `pnpm lint` — PASS.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS; no rules matched.
- `pnpm qa:experience --regression --mode fast` — SKIP: the local Command Center and operator-web routes were not running. The generated QA artifact records all three failed reachability preflight checks; the R-level gate accepts the artifact and passes.
- `pnpm verify` — PASS.
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

This T2 change does not touch runtime DB code — `pnpm test:db` is run only to satisfy the Proof Auditor Gate's blanket `--require-executed-command "pnpm test:db"` check.
