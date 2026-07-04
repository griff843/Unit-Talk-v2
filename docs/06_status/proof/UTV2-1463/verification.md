# UTV2-1463 Verification

## Verification

Commands run from `/home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__utv2-1463-closeout-concurrency-hardening`.

| Command | Result | Notes |
|---|---:|---|
| `node -e "const fs=require('fs'); const YAML=require('yaml'); YAML.parse(fs.readFileSync('.github/workflows/post-merge-lane-close.yml','utf8')); console.log('workflow yaml parse ok')"` | PASS | Workflow YAML parsed successfully. |
| `npx tsx --test scripts/ops/lane-close.test.ts` | PASS | 56 tests passed, including the post-merge lane close workflow assertion. |
| `pnpm type-check` | PASS | TypeScript project references completed successfully. |
| `pnpm test` | PASS | Root aggregate test command completed successfully. |
| `pnpm verify` | FAIL | Static gate, build/test, and live DB smoke progressed; live T1 proof failed in an unrelated ingestor live-data precondition. |
| `npx tsx --test apps/ingestor/src/t1-proof-utv2-1282-bounded-dedup.test.ts` | FAIL | Reproduced the same live proof assertion outside `pnpm verify`. |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS | `Verdict: PASS`; rules matched none. |
| `pnpm exec tsx --test scripts/ops/lane-close.test.ts scripts/ops/workflow-hardening.test.ts` | PASS | Re-run 2026-07-04 after adding the bookkeeping push rebase-and-retry loop — TAP: `# tests 83` / `# pass 83` / `# fail 0`; workflow YAML re-parsed clean. |

## Verify Blocker

`pnpm verify` failed during `pnpm test:t1-proof:live`, after `pnpm test:db` passed 7/7. The failing proof was:

```text
apps/ingestor/src/t1-proof-utv2-1282-bounded-dedup.test.ts
AssertionError: recent event must have at least one existing combination inside the 72h window
expected: true
actual: false
```

The focused rerun of that same file reproduced the failure with the same assertion. This lane changed only `.github/workflows/post-merge-lane-close.yml` before proof files were added, so the failure is outside the allowed file scope and cannot be repaired in this lane without widening scope.

## Gate Status

- `pnpm type-check`: PASS
- `pnpm test`: PASS
- `pnpm verify`: BLOCKED by live DB proof precondition in `apps/ingestor/src/t1-proof-utv2-1282-bounded-dedup.test.ts`
- R-level check: PASS, no matched rules
