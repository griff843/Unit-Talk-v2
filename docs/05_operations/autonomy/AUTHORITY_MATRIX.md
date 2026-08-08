# Authority Matrix

**Status:** Canonical contract — AUT-1
**Purpose:** Exactly what each mode and each actor may and may not do. This document is the merge of two
axes (mode × actor) into one table per action category, so a single lookup answers "is this action allowed
right now, by this actor."

**Actors:**
- **Kernel** — the autonomy control plane itself (AUT-2's code), acting without a human driving the
  keyboard in that moment.
- **Claude** — Claude Code acting as a dispatched executor for a lane the kernel (or a human) started.
- **Codex** — Codex CLI/Cloud acting as a dispatched executor for a lane.
- **Griff** — the owner. Only actor with unconditional authority over the kernel itself.

Claude and Codex rows are **identical** in this matrix — dispatched-executor authority does not vary by
which model executed the lane. Where the existing `DELEGATION_POLICY.md` already distinguishes them (e.g.
Codex is Tier-C-ineligible entirely, `packages/domain/**`/`packages/contracts/**` forbidden to Codex
regardless of tier per `three-brain.md` Rule 1/2), that stricter rule still applies **on top of** this
matrix — this matrix does not loosen anything `DELEGATION_POLICY.md` already forbids.

---

## 1. Never-permitted actions (all actors, all modes)

These are permanently outside this system's authority. No mode, no future amendment to `LIMITS.md` or
`MODE_CONTRACT.md`, and no owner promotion changes these — changing them requires retiring this document
and replacing it with a new ratified contract, which is itself a Tier C / self-amendment act
(`DELEGATION_POLICY.md` "Self-amendment").

| Action | Kernel | Claude (dispatched) | Codex (dispatched) |
|---|---|---|---|
| Plan, dispatch, or merge T1-tier work | **Never** | Never *via the kernel* (Claude may still do T1 work in a human-invoked session, unrelated to this system) | Never (already forbidden — `DELEGATION_POLICY.md` "Tier C is Claude Code only") |
| Touch production credentials, secrets, `.env*`, webhook URLs, OAuth/API keys | **Never** | Never | Never |
| Modify `packages/domain/src/**`, `packages/contracts/src/**` | **Never** | Never *via kernel dispatch* | Never (pre-existing rule) |
| Modify `supabase/migrations/**` or any DDL | **Never** | Never *via kernel dispatch* | Never |
| Modify `packages/db/src/{lifecycle,repositories,runtime-repositories}.ts` | **Never** | Never *via kernel dispatch* | Never |
| Modify `apps/api/src/distribution-service.ts`, `GOVERNANCE_BRAKE_SOURCES`, promotion/scoring policy weights | **Never** | Never *via kernel dispatch* | Never |
| Modify `apps/api/src/auth.ts` or RBAC/route protection | **Never** | Never | Never |
| Activate a deferred/new Discord delivery target | **Never** | Never | Never |
| Modify its own governance surface: `docs/governance/CONCURRENCY_CONFIG.json`, `docs/governance/LANE_CONCURRENCY_POLICY.md`, `docs/05_operations/DELEGATION_POLICY.md`, `.github/workflows/merge-gate.yml`, this autonomy contract set, or its own scheduler workflow file | **Never** | Never *via kernel dispatch* | Never *via kernel dispatch* |
| Grant itself, or any actor, additional merge authority beyond what `merge-gate.yml` already defines | **Never** | Never | Never |
| Disable, delete, or bypass the kill switch, or dispatch a PR that would do so | **Never** | Never | Never |
| Mutate production DB rows outside the existing sanctioned write path (backfills, corrections, cleanups) | **Never** | Never *via kernel dispatch* | Never |
| Post to public/member-facing Discord, smart-form, or any member-visible surface as an operational/status action | **Never** | N/A (this matrix governs the kernel's own operational notifications, not a dispatched lane's product code) | N/A |

These rows are the concrete instantiation of `THREAT_MODEL.md` #2 (self-permission-escalation) and #6
(kernel disables its own kill switch). They are enforced independently at two layers: the CI sensitive-path
guard already in place for these paths (`DELEGATION_POLICY.md` sensitive-path matrix), and the kernel's own
pre-dispatch sensitive-path check (`THREAT_MODEL.md` #3) refusing to even attempt a dispatch packet whose
`file_scope_lock` touches any of these paths — belt and suspenders, neither is sufficient alone.

---

## 2. Mode-conditioned actions

| Action | `halted` | `shadow` | `t3_live` | `t2t3_live` |
|---|---|---|---|---|
| Kernel wakes on schedule and reads state | Yes (no-ops immediately) | Yes | Yes | Yes |
| Kernel runs Gate 0-4 evaluation | No | Yes | Yes | Yes |
| Kernel builds T2/T3 candidate queue | No | Yes (logged, not acted on) | Yes | Yes |
| Kernel calls `ops:lane-start` for a T3 candidate | No | No (shadow-logs "would call") | Yes | Yes |
| Kernel calls `ops:lane-start` for a T2 candidate | No | No (shadow-logs "would call") | No (T2 not yet authorized) | Yes |
| Kernel opens a PR for a dispatched lane | No | No | Yes (T3 lanes only) | Yes (T2 and T3 lanes) |
| Kernel applies `gh pr review --approve` and merges (T3) | No | No | Yes, via `ops:merge-wrapper` only | Yes |
| Kernel applies `gh pr review --approve` and merges (T2) | No | No | No | Yes, via `ops:merge-wrapper` only, subject to the same sensitive-path exclusion as §1 |
| Kernel writes to Linear (issue state transitions) | No | No | Yes, via `ops:lane-close` only, same as any human-invoked lane close | Yes |
| Kernel emits notifications (`NOTIFICATION_TAXONOMY.md`) | Yes, minimal (halt confirmation only) | Yes | Yes | Yes |
| Kernel auto-rolls back its own mode | No (already floor state) | No (already floor of the auto-rollback range — see `PROMOTION_ROLLBACK_STANDARDS.md`) | Yes (to `shadow`, on defined triggers) | Yes (to `t3_live`, on defined triggers) |
| Kernel auto-halts (hard-stop conditions in `LIMITS.md`) | N/A (already halted) | Yes | Yes | Yes |
| Owner promotes mode | Yes (→ shadow) | Yes (→ t3_live) | Yes (→ t2t3_live) | N/A (ceiling) |
| Owner engages kill switch | Yes (no-op) | Yes | Yes | Yes |
| Owner reads kernel state / audit log | Yes | Yes | Yes | Yes |

A dispatched **Claude/Codex executor**, once a lane is started (by kernel or by human), operates under
exactly the same Tier A/B/C rules as any other lane execution — this matrix does not create a separate,
looser rule set for kernel-originated lanes. The kernel choosing to dispatch a T2 lane does **not** grant
that lane's executor any authority beyond ordinary Tier B execution; the executor still cannot touch §1
paths, still needs green CI, still goes through `ops:lane-close`.

---

## 3. Read vs. write authority

| Surface | Kernel read | Kernel write | Griff read | Griff write |
|---|---|---|---|---|
| Lane manifests (`docs/06_status/lanes/*.json`) | Yes | Only via `ops:lane-start`/`ops:lane-close` (never hand-edit) | Yes | Yes (via `--override` per existing policy) |
| Kernel's own execution-state (`schemas/autonomy_execution_state_v1.schema.json` instance) | Yes | Yes, append/update per cycle | Yes | Yes (including forcing `halted: true` — this **is** the kill switch's in-band layer) |
| Audit log (`schemas/audit_event_v1.schema.json` instances) | Yes | Append-only, never edit/delete existing entries | Yes | Read-only in the same append-only sense; a correction is a new event, never a mutation of history |
| `CONCURRENCY_CONFIG.json`, `DELEGATION_POLICY.md`, this contract set | Yes (must read every cycle to stay current) | **Never** | Yes | Yes (PM-gated PR, per existing policy) |
| Production/canary environment config, secrets | **Never** (not even read) | **Never** | Yes | Yes |

---

## 4. Relationship to `DELEGATION_POLICY.md`

This matrix is **additive and stricter**, never looser, than `DELEGATION_POLICY.md`. Where the two overlap
(Tier A/B/C classification, sensitive-path matrix, always-escalate list), `DELEGATION_POLICY.md` remains the
authority for what a *human-driven* Claude session may do; this matrix additionally constrains what the
*unattended kernel* may do, which is always a subset. Concretely: a human orchestrator session may, under
Tier A, merge a `docs/05_operations/**` PR autonomously — the kernel may too, **except** for the specific
governance/self-amendment paths carved out in §1 above, which are off-limits to the kernel even where
`DELEGATION_POLICY.md` would allow a human-driven Tier A merge. When in doubt, the kernel's own action is
governed by whichever of the two documents is stricter for that path.
