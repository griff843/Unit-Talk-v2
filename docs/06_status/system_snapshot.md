# System Snapshot

This file is the current-state handoff for `unit-talk-v2`.

Use it to bootstrap a new chat or agent without relying on prior thread memory.

## Authority Note

For current program state see:
- `docs/06_status/PROGRAM_STATUS.md`

This file is the evidence record: specific IDs, receipts, and historical proof.

## Snapshot Date

- 2026-03-21 (updated Week 16 closeout)

## Workspace

- active repo: `C:\dev\unit-talk-v2`
- legacy reference repo: `C:\dev\unit-talk-production`

## Current Stage

- Week 6 complete (runtime promotion gate, CI hardening, migration 005 applied, 55/55 tests pass)
- Week 7 active: controlled real-channel Best Bets activation
- first real-channel `discord:best-bets` post has been sent; monitoring window remains active

## Proven Runtime Capabilities

- live Supabase is connected and verified
- generated DB types are in use
- API submission path is live
- canonical picks are created from validated submissions
- lifecycle transitions are enforced
- outbox enqueueing works
- worker claim/retry/sent behavior works
- distribution receipts and audit logs are recorded
- successful Discord delivery moves picks to `posted`
- operator-web can read outbox, runs, receipts, picks, and audit state
- smart-form can submit through the API-owned submission path
- smart-form returns browser-facing confirmation and validation feedback
- runtime promotion evaluation is wired before Best Bets enqueue
- non-qualified picks are blocked from `discord:best-bets`
- operator overrides persist with history and audit

## Live Routing Policy

- `discord:canary` is live (permanent control lane)
- `discord:best-bets` is live, runtime-gated, and mapped to the real channel `1288613037539852329`
- `discord:game-threads` and `discord:strategy-room` remain blocked

Reference:
- `docs/05_operations/discord_routing.md`

## Latest Verified Live Canary

Latest known embed-path canary proof:
- submission: `e86e4a9f-631d-46ed-952a-6fcb11b39d5b`
- pick: `8682da20-2fee-4842-ab5b-a68de00eaf75`
- outbox: `5795a491-6956-4bad-90af-04ac87087af5`
- receipt: `04f452c2-1e1d-4623-b332-2acc1a18fb73`
- Discord message: `1484472576418779178`

## Current Operator Read Model

Steady-state live snapshot after the first real-channel Best Bets post:
- worker: healthy
- distribution: healthy
- pending outbox: 0
- processing outbox: 0
- failed outbox: 0
- sent outbox: 3
- `canary.graduationReady = true`

## Verification Commands

Current expected green commands:
- `pnpm lint`
- `pnpm type-check`
- `pnpm build`
- `pnpm test`
- `pnpm test:db`

## Best-Bets Preview Proof

A preview was sent through the live worker path, routed to `discord:canary` for safe review:
- submission: `167ed24a-b46c-419f-9491-0c62f85b8707`
- pick: `41c8e72a-7f9c-4e31-9dfb-0742b6af38d2`
- outbox: `9414eeb9-164d-4469-b164-bcbd4ab6ebce`
- receipt: `8a9ba374-31e7-4067-ac2a-2b8bd3301f34`
- Discord message: `1484584572057419814` (in canary channel)

## Week 6 Runtime Capabilities

- Promotion fields live in schema: `approval_status`, `promotion_status`, `promotion_target`, `promotion_score`, `promotion_reason`, `promotion_version`, `promotion_decided_at`, `promotion_decided_by`
- `pick_promotion_history` table live (migration `202603200005_pick_promotion_state.sql` applied)
- runtime promotion evaluation wired into submission/distribution path
- non-qualified picks blocked from `discord:best-bets` enqueue
- operator overrides persisted and auditable
- `pnpm test` passes `55/55`
- `pnpm test:db` passes `1/1`

## Week 7 Activation - Initial Proof Bundle

Reference template:
- `docs/06_status/week_7_proof_bundle_template.md`

- submission ID: `0523898a-8491-47c6-b991-a7ac814f9177`
- pick ID: `a955039c-616a-4821-bd2a-098a799feb28`
- promotion score: `92.2`
- promotion reason: `hard eligibility checks passed | promotion score 92.20 meets threshold 70.00`
- promotion status: `qualified`
- promotion target: `best-bets`
- promotion history ID: `14da895c-f06c-4baf-b0d5-d9b34030188a`
- outbox ID: `a938db43-c932-438c-9e32-32914c0b3cf8`
- outbox status: `sent`
- receipt ID: `bab12015-31f8-4835-9995-fe154557318e`
- Discord message ID: `1484607152575352912`
- target channel ID: `1288613037539852329`
- run IDs:
  - `aaeb10db-672c-4cba-9f2c-ba4065de0612` (`distribution.enqueue`)
  - `cce8580e-cf96-460e-9dd2-079aff04eeb0` (`distribution.process`)
- audit action IDs:
  - `d89a3b52-b806-402e-b18e-ef55ad27052b` (`promotion.qualified`)
- operator snapshot timestamp: `2026-03-20T17:38:47.401Z`
- worker health: `healthy`
- canary health: `graduationReady = true`, `recentSentCount = 3`, `recentFailureCount = 0`, `recentDeadLetterCount = 0`

## Week 7 Activation — Monitoring Closeout

Final verification timestamp: 2026-03-20 (post-monitoring window).

Verified via Supabase PostgREST REST API (service_role_key):

| Check | Result |
|---|---|
| All `discord:best-bets` outbox rows | 2 rows — both `sent`, zero `failed` or `dead_letter` |
| Failed/dead_letter across all targets | 0 |
| Canary recent outbox | 3 recent `sent` rows, 0 failures |
| Best-bets receipt `bab12015` | `discord:1288613037539852329`, dryRun: false |
| Pending/processing outbox rows | 0 — operator view clean |

**Verdict: PASS. No rollback trigger fired. Week 7 closed.**

## Week 8 First Posted-to-Settled Proof

Reference template:
- `docs/06_status/week_8_first_settlement_proof_template.md`

- submission ID: `0523898a-8491-47c6-b991-a7ac814f9177`
- pick ID: `a955039c-616a-4821-bd2a-098a799feb28`
- posted lifecycle event ID: `cdbd70d9-c028-41cb-bb08-0c29800dd203`
- settlement record ID: `fb8c8ddf-e0fe-44d4-8c5e-1e129633931f`
- settlement status/result: `settled / win`
- settlement source: `operator`
- settlement evidence reference: `proof://week8/first-posted-settled`
- correction link: `null`
- settled lifecycle event ID: `7e03c870-4d68-4d88-8e7c-63978a8d3fef`
- audit action IDs:
  - `3a9825dd-9ac3-48f6-8858-a1ef22d10d9d` (`settlement.recorded`)
- operator snapshot timestamp: `2026-03-20T19:12:16.006Z`
- final pick lifecycle state: `settled`

Canonical API request used:

```json
{
  "status": "settled",
  "result": "win",
  "source": "operator",
  "confidence": "confirmed",
  "evidenceRef": "proof://week8/first-posted-settled",
  "notes": "First canonical posted-to-settled proof run",
  "settledBy": "operator"
}
```

Operator verification at capture time:
- settlement row visible in operator read model
- worker health: `healthy`
- distribution health: `healthy`
- rollback/failure triggers observed: none

## Week 8 Settlement — Independent Verification Closeout

Verified via Supabase PostgREST REST API (service_role_key). Timestamp: 2026-03-20.

| Check | Result |
|---|---|
| Settlement record `fb8c8ddf` | exists — result `win`, source `operator`, status `settled`, corrects_id null |
| Pick lifecycle chain | validated → queued → posted → settled — all 4 events confirmed |
| Settled lifecycle event `7e03c870` | from_state `posted`, to_state `settled`, writer_role `settler` |
| Audit entry `3a9825dd` | action `settlement.recorded`, actor `operator`, entity_id = settlement record, entity_ref = pick ID |
| Original outbox `a938db43` | status `sent` — unmodified (updated_at unchanged since Week 7 post) |
| Original receipt `bab12015` | status `sent`, channel `discord:1288613037539852329` — unmodified |
| Failed/dead_letter outbox rows | **0** |

**Verdict: PASS. No failure trigger fired. Week 8 closed.**

## Week 9 Full Lifecycle Proof

Reference template:
- `docs/06_status/week_9_full_lifecycle_proof_template.md`

Canonical API requests used:

Submission:

```json
{
  "source": "week9-proof",
  "submittedBy": "codex",
  "market": "NBA points",
  "selection": "Player Over 26.5",
  "line": 26.5,
  "odds": -110,
  "stakeUnits": 1,
  "confidence": 0.93,
  "eventName": "Week9 Proof Game 1774035819573",
  "metadata": {
    "sport": "NBA",
    "eventName": "Week9 Proof Game 1774035819573",
    "capper": "Unit Talk",
    "promotionScores": {
      "edge": 96,
      "trust": 94,
      "readiness": 92,
      "uniqueness": 91,
      "boardFit": 95
    }
  }
}
```

Settlement:

```json
{
  "status": "settled",
  "result": "win",
  "source": "operator",
  "confidence": "confirmed",
  "evidenceRef": "proof://week9/full-lifecycle/1e40951c-696a-4339-98cd-1d743b072c7a",
  "notes": "Week 9 full lifecycle proof run",
  "settledBy": "operator"
}
```

Proof fields:
- submission ID: `a6a45d66-9a68-4005-a9f8-61394d9634ee`
- submission event ID: `3517be80-0866-4d14-af5d-a7356c012676`
- submission source: `week9-proof`
- submission created at: `2026-03-20T19:43:39.581+00:00`
- pick ID: `1e40951c-696a-4339-98cd-1d743b072c7a`
- approval status: `approved`
- pick created at: `2026-03-20T19:43:39.581+00:00`
- promotion history ID: `b2c46b06-355f-4dcf-871f-7647019da0d9`
- promotion status: `qualified`
- promotion target: `best-bets`
- promotion score: `94.1`
- promotion reason: `hard eligibility checks passed | promotion score 94.10 meets threshold 70.00`
- promotion decided at: `2026-03-20T19:43:40.227+00:00`
- outbox ID: `4d9db6ed-e71d-4a04-8f1c-c652f335aea4`
- outbox target: `discord:best-bets`
- outbox status: `sent`
- posted lifecycle event ID: `dc968359-8746-4074-96d7-136e22b5c953`
- receipt ID: `4efafbb4-5804-4edc-a8ad-d57ce8d1eab2`
- Discord message ID: `1484638587143327895`
- target channel ID: `1288613037539852329`
- receipt status: `sent`
- dryRun: `false`
- settlement record ID: `894f4872-b397-4396-9ff8-3c8e94c0c814`
- settlement status/result: `settled / win`
- settlement source: `operator`
- settlement confidence: `confirmed`
- settlement evidence reference: `proof://week9/full-lifecycle/1e40951c-696a-4339-98cd-1d743b072c7a`
- correction link: `null`
- settled by actor: `operator`
- settled lifecycle event ID: `b66be150-a543-4a96-8e78-7fe99c752063`
- audit action IDs:
  - `bfbb47e5-2451-4326-9ecc-5ee29f55114c` (`promotion.qualified`)
  - `8ccd6bf9-d5f3-4f37-832b-073690b7e64f` (`distribution.sent`)
  - `eaa69712-ae12-4191-920b-6b683f4e9895` (`settlement.recorded`)
- operator snapshot timestamp: `2026-03-20T19:43:41.940Z`
- final pick lifecycle state: `settled`

Verification summary:
- pre-run checks passed: `pnpm type-check`, `pnpm build`, `pnpm test` (`60/60`), `pnpm test:db` (`1/1`)
- lifecycle chain confirmed: `validated -> queued -> posted -> settled`
- all 3 audit entries confirmed
- settlement row visible in operator read model
- worker health at snapshot: `healthy`
- distribution health at snapshot: `healthy`
- original outbox row unmodified after settlement: `true`
- original receipt row unmodified after settlement: `true`
- failed/dead_letter outbox rows at close: `0`

Week 9 proof result:
- runtime proof run: `pass`
- independent verification readiness: `ready`
- rollback/failure trigger observed: `none`

## Week 9 Full Lifecycle — Independent Verification Closeout

Verified via Supabase PostgREST REST API (service_role_key). Timestamp: 2026-03-20.

| Check | Field | Result |
|---|---|---|
| CHECK 1 | Submission `a6a45d66` | exists — source: `week9-proof`, submitted_by: `codex` |
| CHECK 2 | Submission event `3517be80` | exists — event_name: `submission.accepted`, submission_id matches |
| CHECK 3 | Pick `1e40951c` | exists — approval: `approved`, promotion: `qualified`/`best-bets`, score: `94.10`, status: `settled` |
| CHECK 4 | Promotion history `b2c46b06` | exists — qualified, best-bets, score 94.10, override_action: null |
| CHECK 5 | Outbox `4d9db6ed` | target: `discord:best-bets`, status: `sent` |
| CHECK 6 | Receipt `4efafbb4` | channel: `discord:1288613037539852329`, dryRun: false, Discord message ID: `1484638587143327895` |
| CHECK 7 | Settlement `894f4872` | result: `win`, source: `operator`, confidence: `confirmed`, corrects_id: null, status: `settled` |
| CHECK 8 | Lifecycle chain | validated → queued → posted → settled — all 4 events confirmed, IDs match proof bundle |
| CHECK 9a | Audit `bfbb47e5` | action: `promotion.qualified`, entity_id: `b2c46b06`, entity_ref: `1e40951c` |
| CHECK 9b | Audit `8ccd6bf9` | action: `distribution.sent`, entity_id: `4d9db6ed`, actor: `worker-week9-proof` |
| CHECK 9c | Audit `eaa69712` | action: `settlement.recorded`, entity_id: `894f4872`, entity_ref: `1e40951c` |
| CHECK 10a | Prior outbox `a938db43` (Week 7) | status: `sent`, updated_at: `2026-03-20T17:38:48` — unmodified |
| CHECK 10b | Prior receipt `bab12015` (Week 7) | status: `sent`, channel: `discord:1288613037539852329` — unmodified |
| CHECK 10c | Prior settlement `fb8c8ddf` (Week 8) | status: `settled`, corrects_id: null — unmodified |
| CHECK 11 | Failed/dead_letter outbox rows | **0** |
| CHECK 12 | Pending/processing outbox rows | **0** — operator view clean |

Anti-drift pass result:
- all authority links in `status_source_of_truth.md` and `current_phase.md` verified against disk: **0 broken**
- `active_roadmap.md` reflects true completed sequence
- `system_snapshot.md` updated with verification results
- `week_9_readiness_decision.md` written and ratified

**Verdict: PASS. No failure trigger fired. No kill condition applies. Week 9 closed 2026-03-20.**

## Week 10 Operator Command Center — Implementation Summary

Slices delivered in `apps/operator-web`:

- `OperatorSnapshot` interface extended: `bestBets: ChannelHealthSummary` (line 36), `picksPipeline: PicksPipelineSummary` (line 48)
- `ChannelHealthSummary` interface: `target`, `recentSentCount`, `recentFailureCount`, `recentDeadLetterCount`, `latestSentAt`, `latestReceiptRecordedAt`, `latestMessageId`, `activationHealthy: boolean`, `blockers: string[]`
- `summarizeChannelLane()` function populates both `canary` and `bestBets` from `recentOutbox`
- `summarizePicksPipeline()` function joins picks + settlements, uses DB COUNT queries for accurate totals
- `GET /api/operator/picks-pipeline` standalone endpoint implemented (route at `server.ts:146`)
- HTML dashboard renders "Best Bets Health" and "Picks Pipeline" sections
- `pnpm test`: 62/62 pass (2 new tests added)
- `trader_insights_graduation_criteria.md` created and ratified

## Week 10 Operator Command Center — Independent Verification Closeout

Verified via Supabase PostgREST REST API (service_role_key). Timestamp: 2026-03-20.

| Check | Field | Result |
|---|---|---|
| CHECK 1 | `discord:best-bets` outbox rows | 3 rows, all `sent`: `4d9db6ed` (Week 9), `a938db43` (Week 7), `9414eeb9` (preview) |
| CHECK 2 | `bestBets.activationHealthy` | `true` — 0 failed, 0 dead_letter, recentSentCount=3 |
| CHECK 3 | `bestBets.latestMessageId` | `1484638587143327895` — receipt `4efafbb4`, channel `discord:1288613037539852329`, recorded `2026-03-20T19:43:42.717837+00:00` |
| CHECK 4 | `picksPipeline.counts` | validated=1, queued=1, posted=2, settled=2, total=6 — matches live DB |
| CHECK 5 | Week 9 proof pick `1e40951c` in pipeline | `settled`, `promotion_target=best-bets`, score=94.10; settlement `894f4872`: result=`win` |
| CHECK 6 | `canary.graduationReady` | `true` — 3 sent rows, 0 failures (unchanged from Week 9 close) |
| CHECK 7 | Failed/dead_letter outbox rows (all targets) | **0** |
| CHECK 8 | Pending/processing outbox rows | **0** — operator view clean |
| CHECK 9 | `pnpm test` | 62/62 pass |
| CHECK 10 | `pnpm test:db` | 1/1 pass |
| CHECK 11 | `pnpm type-check` | clean (no errors) |
| CHECK 12 | `pnpm build` | clean (no errors) |
| CHECK 13 | Window coverage (Ambiguity A1) | 6 total outbox rows — all within 12-row default window; concern not triggered |

**Verdict: PASS. No failure trigger fired. No kill condition applies. Week 10 closed 2026-03-20.**

## Current Risks

- old historical rows may add noise to operator incident triage (pre-Week 6 baseline)
- `trader-insights` promotion evaluation path does not exist in current runtime — Week 11 prerequisite before activation

## Immediate Next Work

- Week 11: `discord:trader-insights` activation — requires new promotion evaluation path, activation contract, and graduation gate confirmation
- Keep `discord:canary` active permanently
- Keep `discord:best-bets` live and stable — do not change target map without a defined plan

## Week 11 Trader-Insights Canary Preview Proof

Reference template:
- `docs/06_status/week_11_proof_template.md`

- submission ID: `3bfc5d68-c588-4b59-a2a7-633207cb27a4`
- pick ID: `c231aff2-91a7-4633-ad35-61afb6ec88b6`
- approval status: `approved`
- promotion history ID: `36bdb5d3-a0db-47ff-a4d8-506b0930bf98`
- promotion status: `qualified`
- promotion target: `trader-insights`
- promotion score: `90.20`
- edge score: `91`
- trust score: `89`
- outbox ID: `61d4b4a3-49fa-4b6f-881d-d0bc9133ae06`
- outbox target: `discord:trader-insights`
- outbox status: `sent`
- receipt ID: `aafc482d-c183-48a9-8c13-4256fb2e8b5f`
- receipt channel: `discord:1296531122234327100`
- dryRun: `false`
- Discord message ID: `1484772686579241187`
- embed title: `Unit Talk V2 Trader Insight`
- embed color: `0x4f8cff`
- lead field: `Trader Insights Purpose`
- embed footer: `Target: discord:trader-insights | Market-alerts lane preview`

Preview verification:
- canary remained healthy with `recentSentCount = 3`
- best-bets remained healthy with `recentSentCount = 3`
- failed/dead_letter rows across all targets: `0`

## Week 11 Trader-Insights Real-Channel Activation Proof

Submission request used:

```json
{
  "source": "week11-live",
  "submittedBy": "codex",
  "market": "MLB total bases",
  "selection": "Batter Over 1.5",
  "line": 1.5,
  "odds": -108,
  "stakeUnits": 1,
  "confidence": 0.97,
  "eventName": "Week11 Live Game 1774067986417",
  "metadata": {
    "sport": "MLB",
    "eventName": "Week11 Live Game 1774067986417",
    "capper": "Unit Talk",
    "promotionScores": {
      "edge": 94,
      "trust": 91,
      "readiness": 92,
      "uniqueness": 90,
      "boardFit": 95
    }
  }
}
```

Proof fields:
- submission ID: `1a8d2021-1cfe-42d8-a183-f367e1e0cf82`
- pick ID: `eb12a6c2-0221-44f9-acea-58d684a29fd3`
- approval status: `approved`
- promotion history ID: `1987c936-4233-410b-b48c-592e05933ea4`
- promotion status: `qualified`
- promotion target: `trader-insights`
- promotion score: `92.55`
- promotion reason: `hard eligibility checks passed | promotion score 92.55 meets threshold 80.00`
- outbox ID: `970e688d-897a-4afd-8bde-7bff87396bcd`
- outbox target: `discord:trader-insights`
- outbox status: `sent`
- receipt ID: `d0a5b55a-d7f4-4823-a0dd-cb77747c195f`
- receipt channel: `discord:1356613995175481405`
- dryRun: `false`
- Discord message ID: `1484773505709904043`
- lifecycle event IDs:
  - validated: `184394c2-d4a0-425e-bc35-0db0bdd549b9`
  - queued: `532b9577-437c-4310-b8cb-77723c245e8a`
  - posted: `f68393f8-a1a8-44ca-9640-d0571f88f0bd`
- audit action IDs:
  - `promotion.qualified`: `0c711f93-232d-4d5b-9546-34e90ca46673`
  - `distribution.sent`: `b763d5a5-414a-49b2-af27-ba51786ee0cf`
- final pick lifecycle state: `posted`

Activation verification:
- trader-insights sent rows: `2`
- trader-insights failure rows: `0`
- canary unchanged: `recentSentCount = 3`
- best-bets unchanged: `recentSentCount = 3`
- failed/dead_letter rows across all targets: `0`
- post-activation tests: `pnpm test` = `72/72`, `pnpm test:db` = `1/1`
- one-cycle monitoring observation: clean, no rollback trigger fired

Current Week 11B status:
- activation proof captured cleanly
- ready for independent verification
- formal closeout still pending longer monitoring / external verification

## Week 11B — Independent Verification Closeout

Independently verified via Supabase PostgREST REST API (service_role_key). Timestamp: 2026-03-21.

| Check | Field | Result |
|---|---|---|
| CHECK 1 | Canary pick `c231aff2` | approval_status: `approved`, promotion_target: `trader-insights`, promotion_status: `qualified`, status: `posted` |
| CHECK 2 | Canary promotion history `36bdb5d3` | status: `qualified`, target: `trader-insights`, score: `90.20`, pick_id: `c231aff2` |
| CHECK 3 | Canary outbox `61d4b4a3` | target: `discord:trader-insights`, status: `sent`, pick_id: `c231aff2` |
| CHECK 4 | Canary receipt `aafc482d` | channel: `discord:1296531122234327100`, dryRun: `false` (in payload), Discord msg: `1484772686579241187` |
| CHECK 5 | Real-channel pick `eb12a6c2` | approval_status: `approved`, promotion_target: `trader-insights`, promotion_status: `qualified`, status: `posted` |
| CHECK 6 | Real-channel promotion history `1987c936` | status: `qualified`, target: `trader-insights`, score: `92.55`, pick_id: `eb12a6c2` |
| CHECK 7 | Real-channel outbox `970e688d` | target: `discord:trader-insights`, status: `sent`, pick_id: `eb12a6c2` |
| CHECK 8 | Real-channel receipt `d0a5b55a` | channel: `discord:1356613995175481405`, dryRun: `false` (in payload), Discord msg: `1484773505709904043` |
| CHECK 9 | Lifecycle chain (real-channel pick) | `184394c2` validated, `532b9577` queued, `f68393f8` posted — IDs match proof exactly |
| CHECK 10 | Audit `distribution.sent` (`b763d5a5`) | entity_id: `970e688d` (outbox ID), entity_ref: `null` (consistent with worker behavior) |
| CHECK 11 | Audit `promotion.qualified` (trader-insights) | `fd8879b4`: entity_id `1987c936`, entity_ref: `eb12a6c2` — **Note: proof template had wrong audit ID; corrected here** |
| CHECK 12 | Dual-policy evaluation confirmed | `a8ed8078`: best-bets promotion history for same pick (score 92.55) — pick correctly routes ONLY to trader-insights |
| CHECK 13 | Failed/dead_letter outbox rows | **0** across all targets |
| CHECK 14 | All trader-insights outbox rows | 2 rows: `61d4b4a3` (canary, sent), `970e688d` (real, sent) |
| CHECK 15 | Best-bets regression | 3 rows all `sent` — `4d9db6ed`, `9414eeb9`, `a938db43` — unchanged |
| CHECK 16 | Canary regression | 3 rows all `sent` — unchanged |
| CHECK 17 | Prior artifact: Week 7 outbox `4d9db6ed` | status: `sent` — unmodified |
| CHECK 18 | Prior artifact: Week 9 settlement `894f4872` | status: `settled`, result: `win`, corrects_id: `null` — unmodified |

**Rollback trigger fired:** No

**Discrepancies (non-blocking):**
1. Proof template §2e had audit IDs for the two `promotion.qualified` events inverted. The correct trader-insights promotion.qualified audit is `fd8879b4` (entity_id `1987c936`), not `0c711f93` (entity_id `a8ed8078` = best-bets history row for same pick). Both audits exist and the runtime behavior is correct. Proof template corrected.
2. `distribution.sent` audit `b763d5a5`: `entity_ref` is `null` in DB (worker does not write entity_ref on distribution.sent events — consistent with prior weeks).

**Verdict: PASS. No rollback trigger. No kill condition. Week 11B formally closed 2026-03-21.**

## Week 12 Settlement Hardening — Implementation Evidence

No live DB proof required for Week 12 (hardening week: gaps are in tests and operator surface, not in schema or write path). Evidence is repo-truth: code + test coverage.

### Implementation files changed

- `apps/api/src/settlement-service.ts` — added `recordManualReview`, `recordInitialSettlement`, `recordSettlementCorrection` as named functions; feed source blocked at line 43 (before any DB writes); wrong-state guard at lines 60-72
- `apps/api/src/settlement-service.test.ts` — expanded from 4 to 12 tests (8 new scenarios)
- `apps/operator-web/src/server.ts` — `recentSettlements` in snapshot includes `status` and `corrects_id` fields; HTML renders `[MANUAL REVIEW]` and `[CORRECTION]` labels
- `apps/operator-web/src/server.test.ts` — expanded with 3 new tests (snapshot field coverage, two-phase visibility, HTML labels)

### Test count

| Baseline | New | Total |
|---|---|---|
| 72 (pre-Week-12) | 11 | **83/83** |

New tests: 8 in `settlement-service.test.ts`, 3 in `server.test.ts`.

### Slice-by-slice coverage

**Slice 1 — Manual review resolution path**
- `settlement-service.test.ts:282`: manual_review → settled, two records, pick transitions to `settled`, manual_review row not mutated (status/review_reason/result/corrects_id unchanged)
- `server.test.ts:204`: operator snapshot returns both records for two-phase pick
- `server.test.ts:280`: HTML renders `[MANUAL REVIEW] manual_review` label distinctly

**Slice 2 — Correction chain hardening**
- `settlement-service.test.ts:363`: three-record chain — `C.corrects_id = B.id`, `B.corrects_id = A.id`; results loss/push/win; none mutated
- `server.test.ts:119`: snapshot response includes `corrects_id: 'settlement-original'` for correction record
- `server.test.ts:280`: HTML renders `[CORRECTION] settled` label and `settlement-original` reference

**Slice 3 — Operator settlement history**
- `server.test.ts:36, 55-61`: `recentSettlements` JSON type includes `status` and `corrects_id` fields
- `server.test.ts:119`: deep-equal assertion on status + corrects_id for both record types
- `server.test.ts:204`: pick with two-phase history returns both records (not just latest)

**Slice 4 — Expanded test coverage (all 10 scenarios)**
1. Validated pick rejected → `settlement-service.test.ts:175` (`/found validated/`)
2. Queued pick rejected → `settlement-service.test.ts:196` (`/found queued/`)
3. Missing pick rejected → `settlement-service.test.ts:217` (`/PICK_NOT_FOUND/`)
4. manual_review without reviewReason rejected → `settlement-service.test.ts:238`
5. Two-phase resolution → `settlement-service.test.ts:282`
6. Original record unchanged after correction → `settlement-service.test.ts:323`
7. Three-record chain → `settlement-service.test.ts:363`
8. Snapshot includes status + corrects_id → `server.test.ts:119`
9. Both records returned for two-phase pick → `server.test.ts:204`
10. Correction record corrects_id correct → `server.test.ts:197-201`

**Automated settlement decision**
- `settlement-service.ts:43-49`: `source === 'feed'` throws 409 `AUTOMATED_SETTLEMENT_NOT_ALLOWED` before any DB writes
- `settlement-service.test.ts:258`: confirms `settlements.listRecent()` empty after rejection
- Contract §Automated Settlement Input: explicit binding decision recorded

### Must-not-mutate verification

`settlement-service.ts` writes only to `settlements` repository and `audit` repository. Lifecycle transition (`transitionPickLifecycle`) is called only for initial settlement path. No writes to `distribution_outbox`, `distribution_receipts`, `pick_promotion_history`, or `submission_events`.

### Verification commands

```
pnpm lint       — PASS
pnpm type-check — PASS
pnpm build      — PASS
pnpm test       — PASS 83/83
pnpm test:db    — PASS 1/1
```

**Verdict: PASS. No rollback trigger. No kill condition. Week 12 formally closed 2026-03-21.**

## Week 13 Operator Trader Insights Health — Implementation Evidence

### Implementation files changed

- `apps/operator-web/src/server.ts` — added `traderInsights: ChannelHealthSummary` to `OperatorSnapshot` interface (line 37); `createSnapshotFromRows()` populates via `summarizeChannelLane('discord:trader-insights', ...)` (lines 367-372); `renderOperatorDashboard()` renders "Trader Insights Health" section symmetric with Best Bets Health (lines 644-668)
- `apps/operator-web/src/server.test.ts` — 4 new tests added (lines 125, 146, 191, 228)

No other files changed. No schema changes. No new routes. No write surfaces.

### Test count

| Baseline | New | Total |
|---|---|---|
| 83 (pre-Week-13) | 4 | **87/87** |

New tests:
1. `GET / renders Trader Insights Health section` — `server.test.ts:125`
2. `createSnapshotFromRows marks trader-insights healthy when sent rows exist with no failures` — `server.test.ts:146`
3. `createSnapshotFromRows marks trader-insights unhealthy when failure rows exist` — `server.test.ts:191`
4. `GET /api/operator/snapshot includes traderInsights health section` — `server.test.ts:228`

### Live snapshot verification

Operator snapshot timestamp: `2026-03-21T06:31:15.630Z`
Persistence mode: `database`

| Check | Field | Result |
|---|---|---|
| CHECK 1 | `traderInsights.target` | `discord:trader-insights` |
| CHECK 2 | `traderInsights.recentSentCount` | `2` (2 rows from Week 11: `61d4b4a3` canary, `970e688d` real-channel) |
| CHECK 3 | `traderInsights.recentFailureCount` | `0` |
| CHECK 4 | `traderInsights.recentDeadLetterCount` | `0` |
| CHECK 5 | `traderInsights.activationHealthy` | `true` |
| CHECK 6 | `traderInsights.latestMessageId` | `1484773505709904043` (Week 11B real-channel) |
| CHECK 7 | `bestBets` unchanged | `activationHealthy: true`, `recentSentCount: 3`, `latestMessageId: 1484638587143327895` |
| CHECK 8 | `canary` unchanged | `graduationReady: true`, `recentSentCount: 3`, `latestMessageId: 1484772686579241187` |
| CHECK 9 | `pnpm test` | 87/87 |
| CHECK 10 | `pnpm test:db` | 1/1 |

### Verification commands

```
pnpm lint       — PASS
pnpm type-check — PASS
pnpm build      — PASS
pnpm test       — PASS 87/87
pnpm test:db    — PASS 1/1
```

### Prior section regression check

- `canary`: `graduationReady: true`, `recentSentCount: 3`, `recentFailureCount: 0` — unchanged
- `bestBets`: `activationHealthy: true`, `recentSentCount: 3`, `recentFailureCount: 0` — unchanged
- Settlement records: unmodified (Week 8/9 settlements intact)
- All prior outbox/receipt rows: unmodified

**Verdict: PASS. No rollback trigger. No kill condition. Week 13 formally closed 2026-03-21.**

## Week 14 Verification Control Plane Salvage — Implementation Evidence

### Package structure

`packages/verification/` — new V2-native package with 3 modules:
- `src/scenarios/` — types.ts, definitions.ts, registry.ts, index.ts, registry.test.ts
- `src/run-history/` — types.ts, run-store.ts, query.ts, index.ts, run-store.test.ts, query.test.ts
- `src/archive/` — types.ts, sources.ts, replay-packs.ts, registry.ts, index.ts, registry.test.ts
- `src/index.ts` — public re-exports
- `test-fixtures/` — v2-lifecycle-events.jsonl (4 events, 1 pick), v2-promotion-events.jsonl (4 events, 2 picks)

Dependencies: only `@unit-talk/contracts` — no old repo imports.

### Scenarios

5 V2-native scenarios registered in `DEFAULT_REGISTRY`:
1. `submission-validation` — replay, stages: [validated]
2. `promotion-routing` — replay, stages: [validated, queued]
3. `distribution-delivery` — hybrid, stages: [queued, posted]
4. `settlement-resolution` — replay, stages: [posted, settled]
5. `full-lifecycle` — hybrid, stages: [validated, queued, posted, settled]

Lifecycle stages: `VerificationStage = 'validated' | 'queued' | 'posted' | 'settled'` — V2 only.

### Run History

- `RunStore` writes to `out/verification/runs.jsonl` (append-only) + `out/verification/run-index.json` (atomic rebuild via temp + rename)
- `QueryRunner` wraps RunStore: recent(), failures(), byScenario(), summary()
- `UnifiedRunRecord` fields: runId, scenarioId, mode, commitHash, startedAt, completedAt, durationMs, verdict, stageResults, artifactPath, metadata
- No old-system fields (gateH, determinismHash, watchConditionsFired absent)

### Archive Registry

- 2 archive sources: `v2-lifecycle-fixture`, `v2-promotion-fixture`
- 2 replay packs: `v2-full-lifecycle-pack`, `v2-promotion-routing-pack`
- `getFixturePath()` resolves under `packages/verification/test-fixtures/`

### CLI Query Surface

- `apps/api/src/scripts/query-runs.ts` — 134 lines, formatted table output
- 3 npm scripts in `apps/api/package.json`: `runs:recent`, `runs:failures`, `runs:summary`
- Empty-store behavior verified: `--recent` prints "(no runs found)", `--summary` prints "(no run history)"

### Test count

| Baseline | New | Total |
|---|---|---|
| 87 (pre-Week-14) | 13 | **100/100** |

New tests: 4 scenario + 4 run-store + 2 query + 3 archive = 13.

### Code audit

| Check | Result |
|---|---|
| Old lifecycle stages (PICK_SUBMITTED etc.) | **0** matches |
| Old repo imports (unit-talk-production) | **0** matches |
| Old-system fields (gateH, determinismHash, watchConditionsFired) | **0** matches |
| Rejected modules ported | **0** — no observation, lab, promotion, shadow, fault, strategy dirs |
| Runtime code changes | **0** — `@unit-talk/verification` imported only in CLI script |
| `out/verification/` in .gitignore | **present** — line 13 |

### Verification commands

```
pnpm lint       — PASS
pnpm type-check — PASS
pnpm build      — PASS
pnpm test       — PASS 100/100
pnpm test:db    — PASS 1/1
```

### Infrastructure integration

- Root `tsconfig.json` references `packages/verification` (line 11)
- Root `package.json` test command includes all 4 verification test files
- `apps/api/package.json` depends on `@unit-talk/verification: workspace:*`

**Verdict: PASS. No rollback trigger. No kill condition. Week 14 formally closed 2026-03-21.**

## Week 15 Probability & Devig Math Salvage — Implementation Evidence

### Package structure

`packages/domain/src/probability/` — 7 files added to existing `packages/domain`:
- `devig.ts` — ported from `devigConsensus.ts` (354 lines): americanToImplied, devig methods, consensus, edge, CLV, 12 types, 5 constants
- `probability-layer.ts` — ported from `probabilityLayer.ts` (404 lines): uncertainty, confidence, dynamic cap, pFinal, CLV forecast, orchestrator, 9 types, 3 constants
- `calibration.ts` — ported from `calibrationCompute.ts` (177 lines): Brier, log loss, ECE, MCE, reliability buckets, full metrics, 3 types, 2 constants
- `index.ts` — re-exports all 3 modules
- `devig.test.ts` — 12 tests
- `probability-layer.test.ts` — 9 tests
- `calibration.test.ts` — 7 tests

Source: `C:\dev\unit-talk-production\packages\intelligence\src\probability\` (canonical).
Destination: `packages/domain/src/probability/` (no new package created).

### Integration

- `packages/domain/src/index.ts` line 18: `export * from './probability/index.js'`
- Root `package.json` test command includes all 3 new test files
- Internal import chain: `probability-layer.ts` → `./devig.js`; `calibration.ts` → `./devig.js` (roundTo)

### Test count

| Baseline | New | Total |
|---|---|---|
| 100 (pre-Week-15) | 28 | **128/128** |

New tests: 12 devig + 9 probability-layer + 7 calibration = 28.

### Code audit

| Check | Result |
|---|---|
| Imports from `unit-talk-production` | **0** |
| Supabase or DB imports | **0** |
| Runtime service coupling (Express, HTTP) | **0** |
| Side effects (console, process.env, process.exit) | **0** |
| Old sprint references (INTELLIGENCE-*, SPRINT-024-*) | **0** |
| eslint-disable comments | **0** |
| Rejected modules (offerFetch, KellySizer, expectedValue) | **0** |
| Old import path (devigConsensus) | **0** |
| Changes to existing app runtime code | **0** lines in `git diff HEAD -- apps/` |
| Functions pure (no I/O, no DB) | confirmed |

### Math equivalence

All 18 formulas verified identical to old canonical source:
- `americanToImplied`: `|odds|/(|odds|+100)` or `100/(odds+100)` — matches
- `proportionalDevig`: `P_implied/overround` — matches
- `powerDevig`: `P^k/Σ(P^k)` — matches (uses `**` instead of `Math.pow`, identical result)
- `computeConsensus`: weighted multi-book consensus with fail-closed gates — matches
- `computePFinal`: `p_market + delta × confFactor × (1 - uncertainty)`, clamped [0.01, 0.99] — matches
- `computeBrierScore`: `mean((outcome - predicted)^2)` — matches
- All others: identical

Minor syntactic differences (not math changes): `Number.isFinite` vs `isFinite`, `**` vs `Math.pow`, `+=1` vs `++`.

### Deterministic output verification

| Input | Expected | Actual |
|---|---|---|
| `americanToImplied(-110)` | 0.52381 | 0.52381 |
| `proportionalDevig(0.52381, 0.52381).overFair` | 0.5 | 0.5 |
| `computePFinal(5, 0.55, 0.1, 0.8, 0.04).pFinal` | 0.55 | 0.55 |
| `calculateEdge(0.55, 0.5, 2).ev` | 0.1 | 0.1 |
| `computeBrierScore(4 predictions)` | 0.065 | 0.065 |

### Verification commands

```
pnpm lint       — PASS
pnpm type-check — PASS
pnpm build      — PASS
pnpm test       — PASS 128/128
pnpm test:db    — PASS 1/1
```

### Close criteria (14/14 satisfied)

1. `packages/domain/src/probability/` exists with devig.ts, probability-layer.ts, calibration.ts, index.ts — PASS
2. `packages/domain/src/index.ts` re-exports probability — PASS
3. All 3 test files exist and pass — PASS
4. Root `package.json` test command includes 3 new test files — PASS
5. `pnpm test` ≥ 120 — PASS (128)
6. `pnpm test:db` = 1/1 — PASS
7. `pnpm lint` clean — PASS
8. `pnpm type-check` clean — PASS
9. `pnpm build` clean — PASS
10. Code audit clean (10/10 sub-checks) — PASS
11. No changes to existing app runtime code — PASS
12. Internal import chain verified — PASS
13. Math correctness: deterministic fixed-input tests — PASS
14. Independent verification — PASS

**Verdict: PASS. No rollback trigger. No kill condition. Week 15 formally closed 2026-03-21.**

## Week 16 Settlement Downstream & Full Domain Salvage — Implementation Evidence

### Runtime integration

- `apps/api/src/settlement-service.ts` — `computeSettlementDownstreamBundle()` called on all 3 settlement paths (initial, correction, manual review); `computeLossAttributionForPick()` computes loss attribution when inputs exist; results bundled into `SettlementResult.downstream`
- `apps/api/src/controllers/settle-pick-controller.ts` — canonical settlement API returns `downstream: { effectiveRecordId, effectiveStatus, effectiveResult, correctionDepth, isFinal, totalRecords, pendingReviewCount, correctionCount, hitRatePct, flatBetRoiPct, lossAttributionClassification, unresolvedReason }`
- `apps/operator-web/src/server.ts` — `createSnapshotFromRows()` uses effective corrected settlement result for picks pipeline rendering

### Domain salvage foundation (15 modules, 76 source files, 29 test files)

| Batch | Modules | Source files | Tests |
|---|---|---|---|
| Runtime | `outcomes/outcome-resolver`, `loss-attribution`, `settlement-downstream` | 3 | 40 |
| Batch 1 | `market`, `features`, `models`, `signals` | 15 | 82 |
| Batch 2 | `bands`, `calibration`, `scoring` | 16 | 54 |
| Batch 3 | `outcomes/*`, `evaluation`, `edge-validation`, `market-reaction` | 13 | 56 |
| Batch 4 | `rollups`, `system-health`, `baseline-roi` | 8 | 60 |
| Batch 5 | `risk`, `strategy` | 8 | 67 |

Domain stats: 10,379 source lines, 4,761 test lines across 15 modules.

### Re-export caveats

- `strategy/` not re-exported from top-level domain index (`americanToDecimal` collision with `risk/kelly-sizer`)
- `calibration/` not re-exported (collision with `probability/calibration.ts`)
- `evaluation/` not re-exported (collision with probability/calibration score helpers)

### Boundary verification

| Check | Result |
|---|---|
| `supabase` / DB imports in domain | **0** |
| Legacy repo imports in domain | **0** |
| I/O side effects in domain | **0** |
| All `new Date()` have timestamp injection | **PASS** |

### Gate verification

```
pnpm lint       — PASS
pnpm type-check — PASS
pnpm build      — PASS
pnpm test       — PASS 491/491
```

**Verdict: PASS. Independent verification PASS. Week 16 formally closed 2026-03-21.**

## T1 Full-Cycle Runtime Proof (2026-03-22)

Executed by direct API calls (Smart Form port 4100 zombie process — TCP connected, HTTP unresponsive, could not kill). All 6 wired stages verified via Supabase PostgREST REST API (service_role_key) and live operator-web snapshot.

### Proof ID Chain

| Field | Value |
|---|---|
| submission ID | `ff71daa0-22c3-476a-b1e7-7966c9c1f91c` |
| pick ID | `594be50c-3658-424d-8c5b-7cbd5475bac9` |
| outbox ID | `b5d1a972-76cc-4a57-8501-809032e900b1` |
| receipt ID | `cc70917a-92e6-48ba-855f-fe5786735b7f` |
| Discord message ID | `1485413938513444887` |
| channel ID | `1356613995175481405` (discord:trader-insights) |
| settlement record ID | `7597be77-470b-4dd6-911c-f61cb955817e` |
| worker run ID | `27b4ce2c-*` (system_run) |

### Submission payload

```json
{
  "source": "t1-proof",
  "submittedBy": "griff",
  "market": "NFL passing yards",
  "selection": "QB Over 287.5",
  "line": 287.5,
  "odds": -115,
  "stakeUnits": 1.5,
  "confidence": 0.75,
  "eventName": "NFL Week T1 Proof",
  "metadata": {
    "sport": "NFL",
    "promotionScores": { "edge": 92, "trust": 88, "readiness": 85, "uniqueness": 85, "boardFit": 90 }
  }
}
```

### Stage results

| Stage | Result | Evidence |
|---|---|---|
| 1. Submit via Smart Form | DEVIATION — zombie process; direct API call substituted | TCP connected, HTTP hung; PID 36184 unkillable from bash |
| 2. DB persistence | PASS | submission + pick rows verified via PostgREST |
| 3. Distribution / Discord | PASS | outbox status: `sent`; Discord messageId: `1485413938513444887` |
| 4. Operator-web visibility | PASS | pick visible in recentOutbox; all health=healthy |
| 5. Settlement | PASS | result: `win`; flatBetRoiPct: `90.9%`; lifecycle: `settled` |
| 6. Downstream corrected truth | PASS | settlement record visible in operator-web `recentSettlements` |
| 7. Recap / stats | BLOCKER | Blocker B — no runtime consumer for rollups/evaluation/system-health/baseline-roi |

### Lifecycle chain

`validated → queued → posted → settled` (all 4 transitions confirmed)

### Promotion

- promotion_status: `qualified`
- promotion_target: `trader-insights`
- promotion_score: `88.70`
- promotion_reason: `hard eligibility checks passed | promotion score 88.70 meets threshold 80.00`

### Architectural finding: enqueue gap

`POST /api/submissions` evaluates promotion and sets `promotion_status=qualified` but does NOT auto-enqueue to `distribution_outbox`. The `enqueueDistributionWithRunTracking()` call is not wired to any HTTP endpoint. Distribution outbox must be populated via an explicit out-of-band call. This is a missing wiring between the promotion evaluation and distribution pipeline.

**Verdict: FULL_CYCLE_PROOF_PARTIAL — 6 of 7 stages pass. Stage 7 explicitly blocked (Blocker B). Smart Form stage substituted due to environment issue. Lifecycle chain and all DB truth confirmed. 2026-03-22.**
