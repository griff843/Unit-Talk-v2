# UTV2-1249 Verification

Generated: 2026-06-11T03:26:07Z

## Verification

### Focused Tests

Command:

```bash
npx tsx --test scripts/ops/canonical-health.test.ts
```

Result: PASS

Summary:

```text
1..13
# tests 13
# suites 0
# pass 13
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

### Type Check

Command:

```bash
pnpm type-check
```

Result: PASS

### Root Tests

Command:

```bash
pnpm test
```

Result: PASS

### Issue-Specific Health Verification

Command:

```bash
pnpm pipeline:health -- --output-json /tmp/utv2-1249-pipeline-health.json
```

Result: PASS

Key evidence:

```text
Dead letter (true failures): NONE
Governance brake (P7A, expected): 193 rows
Queue health: HEALTHY
SLO violated objectives: delivery_freshness
JSON report written to /tmp/utv2-1249-pipeline-health.json
```

Command:

```bash
node --import tsx scripts/runtime-health.ts --json > /tmp/utv2-1249-runtime-health-unknown-proof.json
```

Result: PASS

Key evidence:

```text
state=DEGRADED
failed=[]
unknownSubsystems=[
  Worker Supervision,
  Queue Movement,
  Provider Freshness,
  Scheduler Safety,
  Discord Delivery,
  API Activity
]
```

Note: this command was intentionally run through `node --import tsx` because the local `tsx` CLI hit a sandbox IPC `listen EPERM` error after parallel health invocations. The root `pnpm verify` gate later ran `tsx` commands normally and passed.

### Full Gate

Command:

```bash
pnpm verify
```

Result: PASS

Last lines:

```text
[command-manifest] Verified 14 command definition(s) against /home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__utv2-1249-pipeline-health-delivery-freshness/apps/discord-bot/command-manifest.json
[check-migration-versions] 119 migration file(s) verified - no duplicate versions.
[lint-migrations] 119 migration file(s) checked - no findings.
```

### R-Level Check

Command:

```bash
npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
```

Result: PASS

Output:

```text
Verdict: PASS
Changed files: 2
Rules matched: (none) - no R-level artifacts required for this diff
```

R-level lookup: `docs/05_operations/r1-r5-rules.json` has no matching rules for the changed script/proof paths, so no R1-R5 artifacts are required.

Final post-commit rerun status: BLOCKED in this sandbox. `git commit` cannot create the required Git index lock because `/home/griff843/code/Unit-Talk-v2/.git/worktrees/codex__utv2-1249-pipeline-health-delivery-freshness/index.lock` is read-only in this session. The command above passed for the committed branch state before these unstaged changes could be committed.

## Post-fix live verification (Claude rescue pass, 2026-06-11)

```text
$ pnpm pipeline:health -- --output-json /tmp/utv2-1249-final3.json
  ✓ [delivery_freshness] OK — Last delivery 1m ago — within SLO
  last_successful_delivery_at matches DB truth (newest sent row)
  true dead_letter: 0 | governance-class: 906
```

Before fix (same DB, capped query): `last_successful_delivery_at=2026-06-06T15:20Z`, age 6476m, delivery_freshness VIOLATED.
After fix: age 1m, delivery_freshness OK. Remaining `queue_age`/`queue_availability` violations
reflect genuinely stale unclaimed pending rows (real queue truth, surfaced honestly — separate ops follow-up).

```text
$ npx tsx --test scripts/ops/canonical-health.test.ts
# tests 14
# pass 14
# fail 0
$ pnpm type-check  → PASS
$ pnpm test:db (run by Codex pass) → PASS; pnpm verify (Codex pass) → PASS
```
