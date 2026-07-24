# Threat Model

**Status:** Canonical contract — AUT-1
**Purpose:** Concrete threats and their specific mitigations. Every mitigation below cites the exact
contract document/field/mechanism that implements it — this is not a prose risk register, it is a pointer
table from threat to enforceable control.

---

## 1. Runaway loop

**Threat:** the kernel keeps dispatching, retrying, or re-attempting indefinitely — exhausting cost,
spamming PRs, or saturating executor/lane concurrency slots.

**Mitigations:**
- Hard per-cycle dispatch cap (2 new lanes, 3 merges — `LIMITS.md` §3).
- One cycle per invocation, one invocation at a time via concurrency group (`LIMITS.md` §1, §3).
- Consecutive-infra-failure auto-halt (3 — `LIMITS.md` §4) and consecutive-rollback-trigger auto-halt (2 —
  `LIMITS.md` §4) stop the kernel entirely rather than letting it keep trying against a broken environment.
- Rolling 24h cost ceiling forces an automatic mode step-down when spend crosses the PM-set threshold
  (`LIMITS.md` §6).
- Idempotency keys (`CRASH_RESTART_SEMANTICS.md` §3) prevent a retry-after-crash from becoming a duplicate
  action, which would otherwise compound runaway behavior with duplicate side effects.

---

## 2. Privilege escalation via a merged PR that edits its own permissions

**Threat:** a kernel-dispatched (or kernel-merged) lane modifies `CONCURRENCY_CONFIG.json`,
`DELEGATION_POLICY.md`, `merge-gate.yml`, this contract set, or the kernel's own config/scheduler workflow —
directly or indirectly widening the kernel's own future authority.

**Mitigations:**
- `AUTHORITY_MATRIX.md` §1 lists these paths as never-permitted for the kernel, under any mode, permanently.
- Pre-dispatch sensitive-path check (mitigation for threat #3 below) refuses to even generate a live dispatch
  packet whose `file_scope_lock` touches any of these paths — the refusal happens before dispatch, not as a
  post-hoc merge-time catch.
- The existing CI sensitive-path guard (`DELEGATION_POLICY.md` sensitive-path matrix, already enforced
  independent of this system) is a second, pre-existing layer that does not depend on this system working
  correctly.
- Self-amendment of this contract set, `CONCURRENCY_CONFIG.json`, and `DELEGATION_POLICY.md` requires a
  human-authored, PM-approved PR (`OPERATING_MODEL_SONNET5.md` §7 governance-change protocol) — the kernel
  has no code path that could satisfy that requirement even if it tried, because "PM approval" is not
  satisfiable by anything the kernel itself can produce.

---

## 3. Compromised or buggy blocker classifier dispatching something it shouldn't

**Threat:** the tier/scope classification the kernel relies on (Linear tier label, file-scope derivation) is
wrong — either through a bug or a manipulated/mislabeled issue — causing a T1-risk change to be dispatched
under a T2/T3 label.

**Mitigations:**
- The kernel never trusts the Linear tier label alone. Before generating a live dispatch packet, it
  independently evaluates the candidate's declared `file_scope_lock` against
  `DELEGATION_POLICY.md`'s sensitive-path matrix (the same matrix that defines Tier C) — this is the
  `sensitive_path_check` object required on every `dispatch_packet_v1` (deliverable 3). A match refuses the
  dispatch regardless of what tier label Linear carries. This mirrors the existing rule "tier may only be
  lowered by PM, never by agent" (`EXECUTION_TRUTH_MODEL.md` §4) by mechanically enforcing the stricter of
  the two signals rather than trusting the label.
- This check is fail-closed: an issue whose file scope cannot be determined at all (e.g. an issue with no
  declared scope yet) is treated as a sensitive-path match by default, not as "no match found."
- The refusal is not silent — it emits a `candidate_refused_sensitive_path` audit event at `high` severity
  and an immediate notification (`NOTIFICATION_TAXONOMY.md`), because a refusal here is exactly the signal
  that either the classifier or the issue's own labeling needs human attention.

---

## 4. Notification fatigue burying a real escalation

**Threat:** if every routine event pings Griff, the signal-to-noise ratio degrades until a genuine critical
escalation is missed among routine noise.

**Mitigations:**
- `NOTIFICATION_TAXONOMY.md` defines an explicit non-notify list (routine successes, routine refusals,
  cycle heartbeats, mode-unchanged status) — these generate zero individual notifications, digest-only.
- Severity tiers are strict: only `critical` and select `high` events trigger immediate, individual
  notification. Everything else is digest-aggregated.
- Critical events use a distinct channel/marker (dedicated Linear tracking issue + GitHub issue label) from
  the routine daily digest stream, so they cannot be scrolled past as "just more digest content."

---

## 5. Kernel dispatches a T1-tier issue autonomously (schema/logic drift or bypass attempt)

**Threat:** a future code change, bug, or deliberate bypass attempts to route a T1 item through the
autonomous dispatch path.

**Mitigations:**
- `T1_QUEUE_BEHAVIOR.md` §1: T1 is structurally excluded from the candidate query — there is no code path
  where a T1 item becomes an iterable candidate.
- `dispatch_packet_v1.schema.json`'s `tier` enum is literally `["T2","T3"]` — a packet with `tier: "T1"`
  fails schema validation at emission time. This is enforced by the schema validator itself, not by a
  runtime `if` a future edit could accidentally remove.
- No mode in `STATE_MACHINE.md` §2.1 grants T1 authority — there is no state to escalate into even if the
  first two layers were both bypassed.

---

## 6. Kernel disables its own kill switch, or otherwise makes itself unkillable

**Threat:** a buggy or compromised kernel stops checking the `halted` flag, or dispatches a PR that modifies
its own scheduler workflow to remove the schedule trigger's dependency on that flag.

**Mitigations:**
- `KILL_SWITCH_CONTRACT.md` §1's two-layer design: Layer 2 (GitHub-level workflow disable/cancel) does not
  depend on the kernel's own code checking anything — Griff can stop the kernel from ever running again
  regardless of what the in-band flag check does.
- `.github/workflows/**` for the kernel's own scheduler is in `AUTHORITY_MATRIX.md` §1's never-permitted
  list — a kernel-dispatched or kernel-merged PR touching that path is refused by the same sensitive-path
  mechanism as threat #2, so the kernel cannot even attempt this class of self-modification through its own
  dispatch authority.

---

## 7. Stale or incorrect liveness signal causing split-brain or wrongful reaping

**Threat:** (a) two kernel invocations run concurrently and both believe they hold sole dispatch authority
(double-dispatch), or (b) a live, healthy kernel invocation is wrongly declared dead and its in-flight work
reaped mid-operation.

**Mitigations:**
- Heartbeat + TTL liveness (`CRASH_RESTART_SEMANTICS.md` §1), explicitly not raw PID-alive — directly
  addresses the real `merge-mutex.ts` `orphaned_pid` false-positive class observed in this repo on
  2026-07-23 against sequential short-lived invocations.
- GitHub Actions `concurrency` group with `cancel-in-progress: false` (`LIMITS.md` §1) prevents (a)
  mechanically at the scheduler level — a second trigger while one is running is queued, not started.
- The TTL default (900s, `LIMITS.md` §5) is chosen with headroom above the typical cycle duration so
  ordinary jitter never produces a false-dead determination for (b).

---

## 8. Credential or secret exfiltration/misuse by an autonomously-dispatched lane

**Threat:** a kernel-dispatched lane gains access to, logs, or misuses credentials/secrets beyond what an
ordinary human-dispatched lane would have.

**Mitigations:**
- The kernel never provisions new secrets to a dispatched lane — lanes run under exactly the same CI
  secret-scoping as any other lane (`AUTHORITY_MATRIX.md` §1: "touch production credentials... Never," for
  every actor).
- Workflow-file changes (where new secret access would have to be granted) are in the never-permitted list
  (#2, #6 above) — the kernel has no path to widen its own or a dispatched lane's secret access.
- `audit_event_v1.schema.json`'s `detail` field is explicitly documented as forbidden from containing
  recognizable secret patterns, with a CI grep guard as a second layer (AUT-4 scope) — so even an accidental
  secret leak into a log line does not persist into the audit trail.

---

## 9. Silent scope creep — mode ratchets up without re-validation

**Threat:** the kernel (or an operator acting casually) gradually promotes mode without genuinely
re-validating readiness at each step, effectively defeating the purpose of having graduated modes at all.

**Mitigations:**
- `PROMOTION_ROLLBACK_STANDARDS.md` §1 requires an explicit owner action plus a minimum shadow/live duration
  and a zero-hard-fail window before each promotion step — there is no auto-promotion path in
  `STATE_MACHINE.md` §2 at all (the kernel's own code literally cannot raise its own mode).
- Each promotion is recorded in `mode_history` (`autonomy_execution_state_v1.schema.json`) as an append-only,
  auditable record — a pattern of promotions without corresponding validation evidence is itself detectable
  after the fact.

---

## 10. Production/canary environment or credential boundary bypass

**Threat:** the kernel, or a lane it dispatches, merges a change that reaches production or canary without
respecting the identity/environment protections established separately (production/canary environment
protection work in the concurrent migration program).

**Mitigations:**
- The kernel receives **zero** elevated merge authority beyond what `merge-gate.yml` already grants a
  T2/T3 human-driven orchestrator merge (`MODE_CONTRACT.md` — every live mode explicitly cites "using
  exactly the merge authority already in place today"). It does not bypass branch protection, environment
  protection, or required reviewers — it satisfies the same mechanical gate a human satisfies.
- Environment-protection rules ratified elsewhere are a floor this system operates *under*, not a boundary
  it has any special authority to cross — nothing in this contract set grants an exception to those
  protections, and `AUTHORITY_MATRIX.md` §4 states this system is never looser than existing policy.

---

## 11. False confidence from stale proof

**Threat:** the kernel closes a lane (`ops:lane-close`/`ops:truth-check` equivalent) using proof that
predates a later hotfix or change, producing a false "Done" state.

**Mitigations:**
- The kernel does not implement its own truth-check or proof-staleness logic — it calls the existing
  `ops:truth-check` unmodified, inheriting its stale-proof rejection (`TRUTH_CHECK_SPEC.md` §8: P3/P4
  checks, "cannot be waived by `--no-runtime` or any other flag"). This is a deliberate non-goal
  (`COMPATIBILITY_MAP.md`): the kernel reuses the done-gate rather than reimplementing it, precisely to
  avoid a second, potentially weaker truth-check implementation drifting from the canonical one.

---

## 12. Audit log tampering or gap — kernel actions untraceable after an incident

**Threat:** after an incident, there is no reliable record of what the kernel actually did, or the record
has been altered or has silent gaps.

**Mitigations:**
- `audit_event_v1.schema.json`: append-only, monotonically sequenced (`sequence`), optional hash chain
  (`prev_event_hash`) — a sequence gap or hash mismatch is itself a `critical`-severity, immediate-auto-halt
  condition (`LIMITS.md` §4).
- Every mutating action emits a paired `intent`/`outcome` event, so even a crash mid-action leaves a
  forensic trail (an `intent` with no matching `outcome` is exactly the signal
  `CRASH_RESTART_SEMANTICS.md` §2 step 3 reconciles against, and is independently visible to a human auditor
  reading the log directly).
- The kernel never edits or deletes existing audit events (`AUTHORITY_MATRIX.md` §3) — corrections are new
  events, preserving the full history rather than overwriting it.
