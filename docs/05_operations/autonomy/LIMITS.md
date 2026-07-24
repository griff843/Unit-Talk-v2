# Hard Limits — Cycle, Duration, Token/Cost, Retry

**Status:** Canonical contract — AUT-1
**Purpose:** Concrete numbers with rationale. Every number below is a **default** AUT-2/AUT-4 must implement
as a configurable constant (not hardcoded literals scattered through the code) so Griff can retune without a
new lane — but the *defaults* are fail-closed/conservative, and no implementation may ship with a looser
default than stated here without a PM-approved change to this document (self-amendment rule,
`AUTHORITY_MATRIX.md` §1).

**Calibration disclosure:** these numbers are conservative starting points reasoned from the existing,
proven limits already ratified elsewhere in this repo (`LANE_CONCURRENCY_POLICY.md`,
`/loop-dispatch`'s cycle cap, `TRUTH_CHECK_SPEC.md`'s timeout/retry convention) — they are not yet
empirically validated against this new system's real running behavior. `PROGRAM_COMPLETION_DEFINITION.md`
requires a real operating window before certification; tightening or loosening these numbers based on that
window's data is expected and does not itself require re-litigating this document, provided the change stays
at or below these ceilings (loosening any ceiling is a PM-gated change; tightening is not).

---

## 1. Wake frequency

| Parameter | Default | Rationale |
|---|---|---|
| Minimum interval between scheduled trigger firings | **15 minutes** | Frequent enough that a T2/T3-eligible issue doesn't sit idle for hours waiting on the next wake, infrequent enough to bound worst-case kill-switch latency (`KILL_SWITCH_CONTRACT.md` §2) to something Griff can reason about, and to keep the resulting notification/audit volume manageable for `NOTIFICATION_TAXONOMY.md`'s digest-only default. `track-a-monitor.yml`'s existing 6-hour interval is deliberately much looser because it is a read-only watcher with no dispatch payload — this system's interval is tighter because a missed wake has an opportunity cost (idle backlog), not just a staleness cost. |
| Concurrent invocations allowed | **1** (hard) | Enforced by a GitHub Actions `concurrency` group on the scheduler workflow (`group: autonomy-kernel`, `cancel-in-progress: false` — a second trigger while one is running is queued/skipped, never run in parallel). This is the direct fix for the class of bug the merge-mutex `orphaned_pid` incident represents: never let two invocations reason about liveness against each other in the first place. |

---

## 2. Per-cycle and per-operation duration

| Parameter | Default | Rationale |
|---|---|---|
| Max wall-clock duration for one full cycle (`waking` → `idle`) | **20 minutes** | Bounded well under the wake-frequency interval (15 min) is *not* required — a cycle may run longer than the interval between triggers, since the concurrency group (§1) prevents overlap by queuing the next trigger, not by racing it. 20 minutes covers Gate 0-4 plus a bounded number of dispatch actions (§3) with headroom, while still being short enough that a hung cycle is caught by the job-level timeout below rather than running indefinitely. |
| Max wall-clock duration for a single mechanical operation (one `ops:lane-start`, one PR open, one merge call) | **10 minutes** | This is also the kill-switch's worst-case "let it finish" bound (`KILL_SWITCH_CONTRACT.md` §2). Matches the existing convention that external calls get bounded timeouts (`TRUTH_CHECK_SPEC.md` §12: "10s timeout and 1 retry" for individual API calls) scaled up for a multi-step mechanical action rather than a single API call. |
| GitHub Actions job-level timeout | **30 minutes** | Hard outer bound (`timeout-minutes: 30` on the job) — strictly greater than the 20-minute cycle budget so a well-behaved cycle never hits it, but short enough that a genuinely hung process is killed by the platform even if the kernel's own internal timeouts somehow failed. |

---

## 3. Dispatch volume per cycle

| Parameter | Default | Rationale |
|---|---|---|
| Max lanes dispatched (new `ops:lane-start` calls) per cycle | **2** | Deliberately small. Bounds blast radius of a single cycle's decisions (a bad candidate-selection cycle can misfire on at most 2 lanes, not the whole eligible queue) and keeps review/audit load per cycle human-reviewable. Well under the executor concurrency ceiling (`CONCURRENCY_CONFIG.json`: Claude 4 / Codex 6 active lanes total) so the kernel is never the sole reason those caps are approached. |
| Max merges (T2+T3 combined) per cycle | **3** | Slightly higher than the dispatch cap because a merge can also apply to a lane dispatched in a *prior* cycle that has since gone green — merging a backlog of already-approved work is lower-risk than starting new work, so a marginally higher ceiling is reasonable. |
| Max cycles per invocation (a single scheduler run may loop internally rather than dispatch-then-exit) | **1** | Unlike `/loop-dispatch`'s 5-cycles-per-invocation (session-driven, human can watch and interrupt), the unattended scheduled kernel does exactly one cycle per invocation and relies on the 15-minute wake cadence (§1) for its "next cycle," not an internal loop. This keeps each invocation short, keeps the concurrency-group model in §1 simple (one invocation = one cycle = one concurrency slot), and means a stuck cycle can never consume more than one invocation's timeout budget. |

---

## 4. Auto-halt thresholds

| Parameter | Default | Rationale |
|---|---|---|
| Consecutive infra-error cycles before auto-halt | **3** | Mirrors `TRUTH_CHECK_SPEC.md`'s exit-code-3 (infra failure, not truth failure) class — three consecutive cycles unable to even complete Gate 0-4 indicates an environment problem (expired token, unreachable API, corrupted state file), not a transient blip. Auto-halting (not just auto-rolling-back) is correct here because "the environment is broken" is not a signal the kernel's own decision quality is at fault — it's a signal nothing should run until a human looks. |
| Consecutive rollback-trigger cycles before auto-halt (escalation beyond the ordinary one-step rollback) | **2** | If the kernel has already auto-rolled-back once (`PROMOTION_ROLLBACK_STANDARDS.md` §2) and a rollback trigger fires *again* before a human has intervened, that is treated as "the automatic safety net is repeatedly catching real problems," which escalates past "quietly step down one mode" to "stop and get a human," per `THREAT_MODEL.md` #1 (runaway loop). |
| Audit log integrity failure (hash-chain mismatch or sequence gap) | **Immediate auto-halt, threshold of 1** | No retry, no consecutive count — a broken audit trail means the kernel can no longer prove what it is doing, which is disqualifying on its own regardless of whether the underlying dispatch decisions were otherwise fine. |

---

## 5. Liveness / heartbeat

| Parameter | Default | Rationale |
|---|---|---|
| Heartbeat TTL (`autonomy_execution_state_v1.heartbeat_ttl_seconds`) | **900 seconds (15 minutes)** | Generous relative to the 20-minute cycle budget's *typical* case but shorter than the 30-minute hard job timeout — chosen so ordinary cycle jitter never trips a false "presumed dead," while a genuinely wedged process is still detected well before a human would otherwise notice. Explicitly a heartbeat-timestamp check, never a PID-alive check — see `CRASH_RESTART_SEMANTICS.md` §1 for why. |
| Retry count for a single mechanical gate/API call | **1** (matches `TRUTH_CHECK_SPEC.md` §12's existing convention) | No reason to diverge from the pattern already proven for `ops:truth-check`'s own external calls; consistency reduces the number of distinct timeout/retry behaviors an operator has to reason about across the system. |

---

## 6. Token / cost ceiling

| Parameter | Default | Rationale |
|---|---|---|
| Rolling 24h token-spend ceiling (executor dispatch only — Gate 0-4 reads are comparatively cheap and not separately budgeted) | **A PM-set numeric ceiling recorded in the kernel's own config, not this document** — this document fixes the *mechanism and default behavior*, not a dollar/token figure that would go stale the moment model pricing changes. | Concrete currency/token numbers embedded in a canonical doc rot silently (pricing changes, model changes) and nobody re-reads a contract doc to notice. The mechanism — a rolling-window counter (`autonomy_execution_state_v1.cost_counters`) checked before every dispatch — is the durable, checkable contract; the numeric ceiling itself belongs in a config value AUT-4/AUT-5 read at runtime, versioned and PM-adjustable the same way `docs/05_operations/policies/codex-model-routing.json` already separates mechanism (this doc, `LANE_MANIFEST_SPEC.md` §15) from concrete values (the policy JSON). |
| Behavior when the ceiling is reached mid-window | **Auto-rollback one mode step** (not auto-halt) | A cost ceiling is a budget-discipline signal, not a safety/correctness signal — it does not indicate the kernel is doing anything wrong, only that it should do less of it until the window resets. This is why it is listed as a `PROMOTION_ROLLBACK_STANDARDS.md` §2 rollback trigger, not a `LIMITS.md` §4 auto-halt trigger. |
| Window reset | On rolling-window expiry only, never on restart | A restart must reconcile from truth (`CRASH_RESTART_SEMANTICS.md` §2), which explicitly means it must **not** get a free reset of the cost counter — otherwise a crash-loop becomes a way to bypass the ceiling. |

---

## 7. Summary table (defaults at a glance)

| Limit | Default |
|---|---|
| Wake interval | 15 min |
| Concurrent invocations | 1 (hard) |
| Max cycle duration | 20 min |
| Max single-operation duration | 10 min |
| Job-level hard timeout | 30 min |
| Max new dispatches per cycle | 2 |
| Max merges per cycle | 3 |
| Cycles per invocation | 1 |
| Consecutive infra failures → auto-halt | 3 |
| Consecutive rollback triggers → auto-halt | 2 |
| Audit integrity failures → auto-halt | 1 (immediate) |
| Heartbeat TTL | 900s |
| Retry count per mechanical call | 1 |
| Cost ceiling | PM-set config value; mechanism fixed here |
