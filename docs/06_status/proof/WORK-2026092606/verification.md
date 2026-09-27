# PROOF: WORK-2026092606

MERGE_SHA: pending merge

Issue: WORK-2026092606
Tier: T2
Lane type: command-center
Branch: codex/work-2026092606-cc-settlement-truth
result: pass

## ASSERTIONS:

- [x] Settlement history and correction-chain resolution page the complete governed population with
      stable `(created_at, id)` ordering and reconcile every page against the exact database count.
      Incomplete, duplicated, or changing reads fail closed.
- [x] The Operations home does not scan lifetime settlement history for one queue count. It pages only
      current `picks_current_state` rows whose `settlement_status` is `manual_review`, then loads and
      resolves complete immutable histories only for those candidate pick IDs. Tests assert the
      candidate query, bounded `pick_id IN (...)` history query, and disagreement refusal.
- [x] Effective settlement rows preserve their source `payload` and flatten both `clvRaw` and
      `clvPercent`. Dashboard intelligence recognizes CLV from either normalized fields or the payload,
      so correction resolution cannot erase valid CLV evidence.
- [x] Settlement, Exceptions, Operations Overview, and Pipeline agree on one effective settlement truth
      against the named runtime dataset. A corrected pick renders the effective `win`, not the superseded
      result; historical manual-review rows do not remain open.

## EVIDENCE:

### Named production-mode browser/runtime proof

Dataset: `WORK-2026092606-sanctioned-runtime-31-effective`

```json
{"dataset":"WORK-2026092606-sanctioned-runtime-31-effective","settlement":{"effectiveRecords":31,"manualReview":1,"corrections":2},"exceptions":{"manualReview":1},"overview":{"manualReview":1},"pipeline":{"dashboardRead":"available"},"sidebar":{"settlementBadge":"not-present-in-current-navigation"}}
```

The Playwright scenario also asserted that `pick-corrected` displays its effective result `win`, page
1 and page 2 do not overlap, and the absent sidebar badge is not represented as a claimed surface.

### Focused regression evidence

```text
settlement-population.test.ts + operations-home.test.ts
tests 12; pass 12; fail 0

operator-web server.test.ts + command-center server-api.test.ts
tests 16; pass 16; fail 0

full Command Center suite
tests 689; pass 689; fail 0
```

## Verification

```text
pnpm exec tsx --test apps/command-center/src/lib/data/settlement-population.test.ts apps/command-center/src/lib/data/operations-home.test.ts
  PASS — tests 12, pass 12, fail 0

pnpm test:command-center
  PASS — tests 689, pass 689, fail 0

pnpm --filter @unit-talk/command-center type-check
  PASS — exit 0

pnpm exec tsx --test apps/operator-web/src/server.test.ts apps/command-center/src/lib/server-api.test.ts
  PASS — tests 16, pass 16, fail 0

PLAYWRIGHT_BASE_URL=http://127.0.0.1:4311 ... pnpm exec playwright test --config apps/command-center/playwright.config.ts e2e/recovery/settlement-truth.spec.ts --reporter=line
  PASS — 1 passed; named cross-surface runtime measurements shown above

pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
  PASS — matched operator-ui; required qa-experience artifact present

pnpm verify
  PASS — verify:static completed locally. The local live-DB phase then correctly refused the loopback
  target at ci:assert-staging; the same required command is completed for this SHA by the repository's
  staging-ci GitHub environment using CI_SUPABASE_* credentials.
```

The local live-DB refusal is a containment success, not skipped evidence: writable DB verification is
permitted only for staging project `xskgrzbteyqdufktjrjx`. No DB-writing path is changed by this T2
Command Center lane.

## R-level compliance

Rule `operator-ui` matched. Required level: `qa-experience`. Required artifact:
`apps/qa-agent/artifacts/**/result.json` — present. No lifecycle, domain, strategy, migration, or
delivery-authority rule matched.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1667
