# Production acceptance and edge-provenance correction — 2026-09-14

**Status:** RECORD. This document states what was executed against production
`zfzdnfwdarxucxtaojxm` on 2026-09-14, with the evidence measured rather than recalled. It introduces
no threshold, no gate and no policy. Overall production readiness remains governed exclusively by
`docs/05_operations/T1_PRODUCTION_READINESS_CONTRACT.md`, whose first live measurement is
`docs/05_operations/READINESS_MEASUREMENT_2026-09-14.md`.

**What this record is for.** The eighth plan pass predicted a three-step edge-repair sequence and
recorded values derived *offline*. This document records what the deployed system actually did, and
where the prediction and the execution differ. Two of them differ, and both are recorded below
rather than smoothed over.

---

## The authorized sequence, and who owned each step

PM authorization, stated once and quoted because the ordering is the load-bearing part:

> Continue the deployment and complete release verification first. Do not apply the correction until
> deployment succeeds and Griff submits one fresh non-moneyline Track Only pick that confirms the
> repaired fallback behavior. After that acceptance passes, apply the three-row correction in one
> guarded transaction using the exact id + updated_at predicates, including the determined edgeScope
> values. Recompute the affected promotion fields exactly as documented. Require all three row-count
> guards to match or roll back the entire transaction. Return before/after evidence and do not modify
> any other rows.

| # | Step | Owner | Outcome |
|---|---|---|---|
| 1 | Dispatch the production deployment | Griff (reserved decision 8) | run `34858627673`, `success` |
| 2 | Verify the deployed release | Claude, read-only | PASS — see below |
| 3 | Submit a fresh non-moneyline Track Only pick | **Griff — operator action, not delegable** | pick `04174f12`, NFL spread |
| 4 | Read-only acceptance query on the new row | Claude, read-only | PASS |
| 5 | Return the guarded correction packet | Claude | returned, and *corrected by step 4* |
| 6 | Apply the correction in one guarded transaction | Claude, under the authorization above | applied; 3/3 guards matched |

**This ordering is PM's, not the plan's.** `plan.md`'s eighth pass recorded Griff's original
sequencing verbatim — *"deploy repair first, correct rows second, verify with a new non-moneyline
submission third"* — and the authorization above moved verification ahead of correction. Step 5
records why that mattered.

---

## Step 2 — release verification

The strongest available evidence is not the workflow's exit code but the running process attesting to
its own deployed identity. `deploy.yml`'s `Post-deploy functional smoke` curls
`http://localhost:4000/health` *from inside the server* — the Hetzner Cloud firewall blocks port 4000
from runner IPs — and the payload carries `version.deploymentIdentifier`:

```
Raw smoke result: {"httpStatus":200,"body":"{\"status\":\"healthy\",\"service\":\"api\",
  \"persistenceMode\":\"database\",\"runtimeMode\":\"fail_closed\",\"dbReachable\":true,
  \"version\":{\"gitShaShort\":\"a45e9cd1123f\",
              \"***mentIdentifier\":\"a45e9cd1123fed9f9aabc28732fdbcd92a70b2c6\",
              \"scorerRuntimeVersion\":\"candidate-scoring-ownership-v1\",
              \"metadataComplete\":false},
  \"warnings\":[],\"queueHealth\":null,
  \"zombiePicks\":{\"status\":\"healthy\",\"count\":0},
  \"schemaDrift\":{\"status\":\"healthy\",\"materializationStatus\":\"safe\",
                  \"unreachableTables\":0,\"warnings\":[]}}"}
HTTP status: 200
{"verdict":"PASS","httpStatus":200,"checks":[{"name":"health 200","passed":true}]}
```

`***mentIdentifier` is `deploymentIdentifier`; GitHub masks the literal `deploy` as a secret
fragment in log output. The live process reports the target SHA.

| Check | Result |
|---|---|
| Deployed SHA equals target | `a45e9cd1123fed9f9aabc28732fdbcd92a70b2c6`, self-reported by the running API |
| Migrations in range `8521670603a…` → `a45e9cd11` | **0** — no DDL prerequisite, no rollback DDL |
| Changes to `deploy.yml` / `deploy/**` in range | **0** — the containment configuration was read, never written |
| Containment mode | `syndicate_machine_mode.validated` → `mode: parked`, before and after |
| The edge repair is present | `51a764e68` (UTV2-1898) is in the deployed range |
| Container files | 7, all expected |
| Runtime posture | `runtimeMode: fail_closed`, `dbReachable: true`, 0 warnings, 0 schema drift, 0 zombie picks |

---

## Step 4 — acceptance on a fresh non-moneyline pick

Pick `04174f12-9a01-4e4c-94ec-9a7bf70d0538`, created **2026-09-14T17:23:27.788Z** on the new release.
NFL spread, Chiefs -2.5, `Broncos @ Chiefs`, fanatics, odds −110, 3u, conviction 6, Track Only.

A spread rather than another moneyline was deliberate: the honest-provenance guarantee had never been
tested outside moneyline, and this is the first market shape that exercises the participant-scoped
path.

| Assertion | Measured |
|---|---|
| `realEdgeSource` | `confidence-delta` |
| `hasRealEdge` | `false` |
| `realEdgeBookCount` | `0` |
| `edgeProvenance` | `{method: confidence-delta, providerCoverageState: none, fallbackReason: no-event-scope}` |
| `edgeScope` | `{sportKey: NFL, providerEventId: null}` |
| `deviggingResult` | absent |
| `kellySizing` | JSON `null` |
| `domainAnalysis` | exactly 8 keys, none of the five enrichment keys |
| `band` | `SUPPRESS` |
| `promotion_score` | `42.75` |
| `participantResolution` | `canonical`, with real `participants` UUIDs |
| `eventId` | `null` — honest, not fabricated |

**Why `no-event-scope` and not `no-fresh-offer`.** Scope is refused *before* any offer query when
`eventId` is null, so the 6-hour `PROVIDER_OFFER_MAX_AGE_MS` window is never reached. All four
production picks carry `eventId: null`, so all four resolve to `no-event-scope`. `no-fresh-offer`
fires only when an event resolves and no offer is fresh — a state no production pick has yet reached.

**The derivation method was validated by the system rather than by its author.** This pick's inputs
(odds −110, conviction 6, trust 60, `SUPPRESS`) are identical to row 1's *corrected* inputs, and the
live repaired system computed **42.75** — exactly the value derived offline via
`createInMemoryRepositoryBundle()` + `processSubmission()`. That agreement is what made the offline
derivation safe to write to production.

---

## Step 5 — the correction packet contained a factual error, and the acceptance test caught it

The packet asserted `selectedOffer: present → removed`, and used `(metadata - 'selectedOffer')`.

Measurement of the acceptance pick — and then of all three target rows — showed
`jsonb_typeof(metadata->'selectedOffer') = 'null'` on **every one of them**. The key is always
*present* with a JSON-null value, on both the repaired path and the legacy rows. It is written as
null, not omitted.

**The clause was dropped and `selectedOffer` was not touched by the transaction.** Had the packet been
applied on the plan's original ordering — correct before verify — the correction would have deleted a
key the repaired code actually writes, and the corrected rows would have diverged from live behaviour
in a way no later reader could distinguish from a code change.

This is the direct, concrete vindication of PM's re-ordering. It is recorded here because the general
lesson survives this instance: **a correction packet derived offline is a prediction, and the cheapest
test of it is the live system's own output on an equivalent input.**

---

## Step 6 — the guarded transaction

One transaction, three `UPDATE`s, each predicated on `id` **and** the exact `updated_at` read at
packet time, with `GET DIAGNOSTICS` after each and a single guard that rolls back all three unless
every row count is exactly 1.

```sql
IF n1 <> 1 OR n2 <> 1 OR n3 <> 1 THEN
  RAISE EXCEPTION 'GUARD FAILED - rolling back all three. row1=%, row2=%, row3=%', n1, n2, n3;
END IF;
```

Result: no exception raised. All three guards matched; nothing rolled back.

### Before → after, per row

| Field | `dfcd9486` MLB ML | `b534ba0d` NFL ML | `29da425a` NFL spread |
|---|---|---|---|
| guard `updated_at` | `2026-09-09 03:35:02.311339+00` | `2026-09-13 19:42:46.38563+00` | `2026-09-14 13:26:41.550255+00` |
| `realEdge` | 0.121739 → **0.07619** | 0.321739 → **0.287805** | 0.182545 → **0.025532** |
| `hasRealEdge` | true → **false** | true → **false** | true → **false** |
| `realEdgeSource` | sgo → **confidence-delta** | sgo → **confidence-delta** | sgo → **confidence-delta** |
| `marketProbability` | 0.478261 → **0.52381** | 0.478261 → **0.512195** | 0.417455 → **0.574468** |
| `realEdgeBookCount` | 1 → **0** | 1 → **0** | 1 → **0** |
| `edgeProvenance` | market-devigged/sgo → **confidence-delta / none / no-event-scope** | ditto | ditto |
| `edgeScope` | absent → **{MLB, null}** | absent → **{NFL, null}** | absent → **{NFL, null}** |
| `contrarySignal` | sgo/strongly/0.121739 → **confidence-delta/mildly/0.07619** | sgo/strongly/0.321739 → **confidence-delta/strongly/0.287805** | present → **removed** |
| `kellySizing` | object → **null** | object → **null** | object → **null** |
| `deviggingResult` | absent | absent | object → **removed** |
| `domainAnalysis` | 13 keys → **8** | 13 → **8** | 13 → **8** |
| `band` | SUPPRESS | **C → SUPPRESS** | SUPPRESS |
| `promotion_score` | 64.02 → **42.75** | 81.27 → **48.02** | 75.02 → **42.28** |
| `promotion_reason` | unchanged | unchanged | Kelly-fraction string → **standard string** |
| `selectedOffer` | JSON `null`, **untouched** | JSON `null`, **untouched** | JSON `null`, **untouched** |
| `promotion_status` / `promotion_target` | unchanged | unchanged | unchanged |

Two of those cells are worth naming rather than scanning past:

- **`contrarySignal` is gated on classification, not on market type.** `submission-service.ts:331-332`
  writes the key only when `contrarianism !== 'aligned'`, against
  `CONTRARIAN_THRESHOLDS = {strong: 0.08, mild: 0.04}`. Row 3's corrected divergence is 0.025532,
  below the mild threshold, so the key is *removed* rather than rewritten. A correction that rewrote
  it would have recorded a signal the repaired code would not have produced.
- **`domainAnalysis` shrinks because enrichment is skipped on `confidence-delta`.**
  `submission-service.ts:346` guards exactly five keys — `realEdge`, `realEdgeSource`,
  `marketProbability`, `hasRealEdge`, `realEdgeBookCount` — behind
  `realEdgeResult.marketSource !== 'confidence-delta'`, and the same condition at `:354` leaves
  `kellySizing` null. The 13 → 8 change is that guard, verified empirically against the acceptance
  pick's own 8 keys rather than inferred from the code alone.

`picks.promotion_score` is `numeric(5,2)`, so the derived 42.748799 / 48.019200 / 42.280499 store as
42.75 / 48.02 / 42.28.

---

## Blast radius — measured, not asserted

| Measure | Value |
|---|---|
| `picks` rows carrying the transaction timestamp `2026-09-14 17:24:39.891286+00` | **3** |
| Governed cohort `metadata ? 'distributionMode'` | **4** |
| Of those, carrying honest `confidence-delta` / `hasRealEdge = false` | **4 of 4** |
| `distribution_outbox` rows for any cohort pick | **0** |
| `settlement_records` rows for any cohort pick | **0** |
| `execution_intents` rows for any cohort pick | **0** |
| `distribution_outbox` total / newest row | 5747 / **2026-07-30 20:04:41.893448+00**, unchanged |
| Production DDL executed | **0** |
| Rows deleted | **0** |
| Containment settings changed | **0** |
| SGO key read, tested or updated | **none** |

**The acceptance pick was not modified by the transaction**, and the timestamps prove it rather than
merely claiming it: `04174f12` carries `updated_at = 2026-09-14 17:23:31.276371+00` — its own creation
time, 68 seconds before the transaction — while the three corrected rows all carry the transaction's
timestamp.

The old outbox residue was deliberately left alone; clearing it was never authorized and is not
requested.

---

## What this changes about the readiness verdict: the number, not the verdict

`READINESS_MEASUREMENT_2026-09-14.md` Dimension 2 recorded market-backed edge attribution at
**0.00%**, against a naive reading of the same rows that would have said 100% — because all three
picks then claimed `metadata.realEdgeSource = 'sgo'` while no provider offer actually scoped to them.

After this correction the figure is still **0.00%**, and the verdict is still FAIL. What changed is
that the rows now *say* so. The repair makes the zero honest rather than accidental, and a future
reader of those rows can no longer be misled by them.

**No dimension verdict moves, and `overall_pass: false` is unchanged.** Dimensions 1 and 5 and 6
remain FAIL, 3 and 4 remain UNKNOWN. Nothing in this record is an argument that readiness improved.

---

## What was deliberately not done

- **No policy decision on `force_promote`.** All four cohort picks are `promotion_status = qualified`,
  `promotion_target = best-bets` on the strength of their source, at scores 42.28–48.02 against
  `best-bets-v2`'s `minimumScore: 70`. Under Track Only this reaches nothing. It is filed as
  **UTV2-1900** and decided there, not here.
- **No containment change**, no ingestion unpark, no worker activation.
- **No member-delivery activation** — separately reserved, and affirmatively not requested.
- **No further production writes.** The three-row correction was the only authorized write and that
  authorization is now spent.
