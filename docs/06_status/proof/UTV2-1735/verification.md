# PROOF: UTV2-1735

MERGE_SHA: 118bbd6e078410d6a399436c7521fe4a8d587015

Verified source SHA: `118bbd6e078410d6a399436c7521fe4a8d587015`

Substantive implementation SHA: `118bbd6e078410d6a399436c7521fe4a8d587015`

Pre-merge this anchor identifies the complete committed lane source. The substantive implementation and the verified source are the same commit at this revision: the correction commit rewrote the implementation, so the earlier separate substantive anchor (`af9c95d0`) no longer describes the shipped code and has been retired rather than carried forward. Later commits in this lane are restricted to proof artifacts. Post-merge closeout rebinds the proof to the authoritative merge SHA.

## ASSERTIONS:

- [x] A scheduled live-mode detection and notification pass is configured on a five-minute cron (`*/5`) while autonomous system picks remain disabled. **Measured effective cadence is roughly 28 minutes** — GitHub Actions does not honour a five-minute schedule under load (observed gaps of 20/29/36/49/18/24/21 minutes across the last eight runs). Detection latency against a 116-day alerting outage is unaffected.
- [x] **Thresholds are calibrated to the observed cadence, not the nominal one.** An earlier revision of this proof said the five-minute `--production-cadence` clamp on `offers` and `cycle` was left as a follow-up rather than tuned inside this lane. That is no longer true and the earlier statement is withdrawn: this lane now clamps those checks, and the `alert.detection`/`alert.notification` self-monitor threshold, to a 60-minute floor. A ~28-minute real cadence would otherwise mark a healthy system CRITICAL on nearly every pass, and a monitor that cries wolf is how the previous outage stayed invisible for 116 days. This supersedes item 3 of UTV2-1738. `scripts/ingestor-alert-check.test.ts` asserts both directions: a six-minute-old offer is not CRITICAL, a ninety-minute-old one is.
- [x] **Member-facing delivery is refused by default.** `resolveChannels()` in `@unit-talk/alert-runtime` routes the `alert-worthy` tier to both `discord:canary` and the member-facing `discord:trader-insights`, and that package is outside this lane's frozen file scope. Rather than leave live member delivery reachable, this lane enforces the boundary it does own: every Discord message POST passes through `buildChannelGuardedFetch`, which permits only the resolved canary channel and throws on any other channel unless `ALERT_MEMBER_CHANNELS_ENABLED=true` is set as a separate activation decision. It fails closed — when the target map cannot be resolved, no channel is permitted. Proven by inversion in three tests.
- [x] **Persisted-but-undelivered detections are retried without duplicating successful deliveries.** A detection that persisted while Discord was unavailable previously collided with its idempotency key on later passes and was counted as a duplicate rather than returned in `persistedSignals`, so it was never retried after Discord recovered. `mergeUndeliveredDetections` re-submits recent detections whose `notified` flag is false, excluding any already in this pass and any outside a four-hour window. A retry-lookup failure cannot suppress the current pass's own alerts.
- [x] An `always()` monitor job treats stale ingestion, alerting silence, failed notification runs, and unreachable monitoring state as critical. **Scope stated precisely:** this monitor is `needs: alerting-pass` inside the *same* workflow run, so `always()` grants independence from the alerting job's **outcome**, not from the **schedule**. It genuinely fires when the alerting pass fails or degrades across consecutive runs; it is structurally blind to the scheduler never dispatching at all — the failure mode with a documented precedent in this repo (UTV2-1517, GitHub Actions silently not dispatching for 10+ hours). External scheduler-death detection is out of scope here and is owned by **UTV2-1738**. Until that lands, this lane restores alerting and self-monitoring; it does not make alerting undroppable.
- [x] The focused runtime proof induces and observes detection persistence, canary notification, and successful detection/notification run receipts.
- [x] Static repository verification passes; writable DB proof is truthfully deferred to governed staging CI.

## EVIDENCE:

```text
focused runtime: PASS (17 tests, 0 failed)
pnpm verify:static: PASS
proof binding: PASS at the rebound source plus proof-only successor commit
writable DB: BLOCKED_DEFERRED locally; staging CI required
```

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm exec tsx --test 'scripts/ingestor-alert-check.test.ts'` | PASS | 17 tests passed, 0 failed. |
| `pnpm type-check` | PASS | Exit 0. |
| `pnpm lint` | PASS | Exit 0. |
| `pnpm verify:static` | PASS | Environment, policy, lint, type-check, build, aggregate `pnpm test`, Smart Form, and command checks passed. |
| `pnpm verify` | BLOCKED/DEFERRED | The static stage passed; the writable DB stage refused the non-staging workstation target before DB tests ran. |
| `pnpm test:db` | BLOCKED/DEFERRED | Must run in the governed `staging-ci` environment against `xskgrzbteyqdufktjrjx`. |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS | 9 changed files; no R-level rules matched. |

### Focused runtime proof

The focused `node:test` suite executes the actual alert-runtime detection and notification functions with in-memory repositories and a stubbed network boundary. It induces an NBA spread move from `4.5` to `6.5` and observes:

- one persisted alert detection;
- one live-mode notification to `discord:canary`;
- the detection marked notified with its channel persisted;
- successful `alert.detection` and `alert.notification` run receipts.

The suite separately induces stale ingestion, alerting silence, a notification run containing failed deliveries, and a monitor failure. Each becomes a CRITICAL finding and reaches the operations alert sink; the monitor never converts missing evidence into health.

### Member-channel refusal, proven by execution path

A second end-to-end case induces a `4.5` → `9.0` spread move — above the `3.5`
alert-worthy threshold — with **both** `discord:canary` and the member-facing
`discord:trader-insights` resolvable in the target map, so the member channel is
genuinely reachable and only the guard prevents delivery. Observed:

- every outbound request went to the canary channel `1296531122234327100`; none reached `1296531122234327999`;
- `notification.failed` is `0` and `notification.notified` is `1` — a refused member channel is a policy decision, not a delivery failure, so the detection is **not** left unnotified and re-queued forever;
- the detection is persisted at tier `alert-worthy`, marked notified, with `notified_channels = ['discord:canary']`;
- the `alert.notification` run records a non-zero `blockedMemberDeliveries`, so the refusal leaves a durable trace.

The control was validated by inversion rather than by its presence. With the
activation check flipped so the guard returns the raw fetch, the suite fails and
names the breach directly:

```text
not ok 11 - member-facing discord channels are refused unless explicitly activated
  'sent' !== 'refused'
  error: 'member channel was contacted: .../channels/1296531122234327100/messages, .../channels/1296531122234327999/messages'
# fail 3
```

Restoring the guard returns the suite to 17 passed, 0 failed. The guard is
additionally fail-closed: when the target map cannot be resolved, no channel is
permitted.

Focused command trailer:

```text
1..17
# tests 17
# suites 0
# pass 17
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

### Static gate

`pnpm verify:static` passed. This includes the repository-wide `pnpm test` aggregate, where the UTV2-1735 focused cases also passed.

### Writable DB proof

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=unparseable). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.

The local command observed the configured loopback host and refused before executing DB tests:

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
ELIFECYCLE Command failed with exit code 1.
```

No production or non-staging database mutation was attempted. No DB query or row-count result is fabricated.

### Full `pnpm verify` tail

```text
> @unit-talk/v2@0.1.0 test:live-db
> pnpm test:db && pnpm test:t1-proof:live

> @unit-talk/v2@0.1.0 test:db
> pnpm ci:assert-staging && tsx --test apps/api/src/database-smoke.test.ts

> @unit-talk/v2@0.1.0 ci:assert-staging
> tsx scripts/ci/assert-staging-target.ts

[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
ELIFECYCLE Command failed with exit code 1.
ELIFECYCLE Command failed with exit code 1.
ELIFECYCLE Command failed with exit code 1.
ELIFECYCLE Command failed with exit code 1.
```

### Safety posture

The workflow explicitly keeps `SYSTEM_PICKS_ENABLED=false`. It restores real Discord delivery with `ALERT_DRY_RUN=false` without enabling autonomous system-pick submission. The workflow does not add or activate any blocked Discord target.

**Member-facing fan-out — blocked, not merely disclosed.** `resolveChannels` fans an
`alert-worthy` signal to `discord:canary` **and `discord:trader-insights`**, a live
member-facing channel. Two earlier revisions of this section were wrong and are
withdrawn: the first named only canary and omitted the member-facing target; the
second disclosed it but described the path as "sanctioned rather than blocked" and
said it "becomes live the moment ingestion resumes". Member-facing delivery is
unauthorized, so it is now blocked rather than disclosed.

Enforcement is in two layers, because `packages/alert-runtime` is outside this lane's
frozen scope:

1. **Primary — the member target is made unresolvable.** `applyMemberChannelPolicy`
   strips every non-canary entry from `UNIT_TALK_DISCORD_TARGET_MAP` unless
   `ALERT_MEMBER_CHANNELS_ENABLED=true`. The delivery loop skips any channel
   `resolveDiscordChannelId` cannot resolve, so the member channel costs no attempt,
   no retry ladder, and no audit rows.
2. **Defence in depth — the transport refuses it.** `buildChannelGuardedFetch` throws
   on any Discord message POST to a channel other than the resolved canary. It fails
   closed: an absent or malformed target map permits nothing at all.

The workflow pins `ALERT_MEMBER_CHANNELS_ENABLED: 'false'` explicitly. Activating
member delivery is a separate decision, not a config change.

The two-layer design is deliberate. An earlier revision enforced this only at the
transport, which was functionally correct but expensive: a refused channel burned the
full retry ladder — four attempts and seven seconds of real sleep per detection — so
roughly 86 alert-worthy detections would exhaust the job's `timeout-minutes: 10`.
Withholding the target avoids that entirely; the transport guard now records
`blockedMemberChannels`, which should stay `0` and is a tripwire for any path that
resolves a member channel some other way.

**Known limitation, not fixed here.** This policy is enforced in this script only.
`packages/alert-runtime/src/alert-agent.ts` calls `runAlertNotificationPass` with no
injected `fetchImpl`, so the `apps/alert-agent` service would deliver to
`discord:trader-insights` unguarded. That path is dormant — the last `alert.detection`
run in production is 2026-04-28 — but "member delivery is unauthorized" is currently a
property of this entry point, not of the system. Making it a system property requires
changing `resolveChannels` in `packages/alert-runtime`, which is out of scope for this
lane and is recorded as a follow-up.

**Self-monitor tautology, disclosed.** The `monitor` job reads an `alert.detection` row
that the same workflow run wrote roughly two minutes earlier. It therefore fires
mainly when the `alerting-pass` job has already failed or degraded across runs, and it
cannot detect the scheduler going silent. See the assertion above; UTV2-1738 owns the
external dead-man's switch.

**Lane classification, flagged for PM judgment.** This lane is recorded as
`lane_type: governance` / `proof_profile: static`, which is what waives the live-DB
proof requirement, while its purpose is enabling live Discord delivery
(`ALERT_DRY_RUN=false`) and live production DB reads. That classification is stated
here plainly rather than relied on silently.

### Pending external evidence

- Governed `staging-ci` execution of `pnpm test:db` with `CI_SUPABASE_*` credentials.
- Exact-head required checks and independent T1/PM review.
- Post-merge SHA rebind and lane finalization.
