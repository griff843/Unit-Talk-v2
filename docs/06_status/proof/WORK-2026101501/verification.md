# PROOF: WORK-2026101501

MERGE_SHA: pending merge
Issue: WORK-2026101501
Tier: T2
Lane type: delivery-ui
result: pending_ci

## ASSERTIONS:

- [x] Exact retired IDs and nonempty current-bot author identity; foreign and malformed controls ignored.
- [x] One direct private acknowledgement; guild responses ephemeral and DM responses private.
- [x] Replied/deferred interactions ignored; rejected replies logged safely without retry.
- [x] Router tests prove no command dispatch, member lookup or deferral; existing slash behavior retained.

## EVIDENCE:

```text
Focused foundation suite: 114 passed, 0 failed.
Single final pnpm verify: static stage passed; writable stage refused unidentified local target before writes.
Final committed-head R-level check: PASS; matched discord-delivery (R1).
```

## Verification

# WORK-2026101501 verification

- Draft PR: https://github.com/griff843/Unit-Talk-v2/pull/1767 (open, tier:T2, head `b6147916a39c2eb202545d20ba480a44e63ef93a`)
- Focused: `pnpm exec tsx --test apps/discord-bot/src/discord-bot-foundation.test.ts` — PASS, 114/114.
- Static gate: `pnpm verify:static` — PASS, exit 0.
- Required broad gate: `pnpm verify` — exit 1 at the live-DB preflight only. `assert-staging` refused the configured `127.0.0.1` target because its identity was unparseable/unidentified; writable proof requires `xskgrzbteyqdufktjrjx` through the staging-ci GitHub environment with `CI_SUPABASE_*` credentials. Full log: `/tmp/work-2026101501-pnpm-verify.log`.
- R-level: `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS; no matching R-level artifacts required.

No live DB writes, Discord sends, deployment, or runtime acceptance are claimed. The required post-deployment historical-button and no-write proof remains deferred.


## Runtime Verification

Staging-only CI proof is pending; no live Discord acceptance is claimed. Deployment and historical-button click acceptance are reserved.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1767
Approved PR head: pending merge
Execution SHA: e071c9e19060cfe3c51456c2de571a0815d794d9

## Current CI blocker

Source HEAD 799c713e01a7489b59b0a025a7bbd26dc9cf760e; CI run 39027893441, staging job 117382400098: failed. Promotion-replay proof tests 4 and 5 hit database statement timeouts in listByLifecycleStates and getPromotionBoardState. Required verify failed closed. Runtime proof and merge remain blocked; no unrelated API/DB change is authorized.

## Successful pre-merge staging proof

CI run 39028456349, staging job 117383991011 passed on source e071c9e19060cfe3c51456c2de571a0815d794d9. Receipt hash, TAP and staging identity checked; GitHub verified the receipt synthetic merge ref has this PR head as second parent. 9 passing query observations and 8 measured seed counts captured. Overall CI static verification remains pending. This proves staging DB checks, not deployed Discord interactions.

## Post-merge addendum (WORK-2026102003)

Added after merge of PR #1767 (merge commit `e22d68f9c8153afbabf4d88ad0ca102660cba26f`). No line above is changed. The static gate recorded above, `pnpm verify:static`, is the repository script whose chain includes `pnpm type-check` and `pnpm test` (checked against `package.json`: `... && pnpm lint && pnpm type-check && pnpm build && pnpm test && ...`). Its PASS, exit 0, therefore covers both `pnpm type-check` and `pnpm test`. This addendum records that fact for the truth check's command-reference rule; it adds no new measurement and claims no new run.
