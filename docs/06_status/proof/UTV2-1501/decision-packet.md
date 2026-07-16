# UTV2-1501: Constitution vs T2 Self-Approval Reconciliation — PM Decision Packet

Analysis-only deliverable. This lane makes **no changes** to the Constitution,
`.github/workflows/merge-gate.yml`, `CLAUDE.md`, `DELEGATION_POLICY.md`, or any
other governance or CI surface. It hands PM the conflict, three options with
tradeoffs, and a recommendation. All quotations below were re-verified against
the current worktree HEAD at drafting time, not carried forward from the issue
description.

---

## 1. The conflict — exact texts

### 1.1 Constitution: unconditional no-self-certification

`docs/00_constitution/UNIT_TALK_CONSTITUTION_V1.md`:

> **§2.8 Separation of Duties** (lines 144–154)
>
> No actor may implement, review, approve, and certify the same work.
>
> No model may self-certify.
>
> No workflow may self-authorize.
>
> No reviewer may certify their own patch.
>
> No automation may replace PM authority.

> **§2.14 No Self-Certification** (lines ~198–204)
>
> No model, workflow, agent, or operator may certify its own work.
>
> Implementation and verification must be separated.
>
> Reviewer-as-fixer is permitted only when another independent authority
> re-reviews the fix.

> **§9.3 Workflow Rules** (lines 1742–1747)
>
> - implementer cannot self-certify
> - reviewer cannot certify own patch
> - PM authority cannot be replaced by automation
> - T1 lanes require adversarial review
> - T2/T3 lanes may use lighter governance but must remain auditable

> **§22 Constitutional Anti-Patterns** (lines ~2431–2450) — prohibited
> patterns include: `self-certification` (line 2447), `PM approval without
> gate validation`, `admin bypass as normal flow`, `advisory-only governance
> presented as enforcement`.

Note: §9.3's "T2/T3 lanes may use lighter governance but must remain
auditable" is the Constitution's only tier-sensitive language. It does not
define "lighter," and it sits alongside the unconditional §2.8/§2.14 bans —
it is the textual hook a T2 carve-out (Option B) would hang from.

### 1.2 Ratified T2 self-approval workflow

**Root `CLAUDE.md`, Verification expectations / Merge Authority:**

> T2 | type-check + test + issue-specific | Diff summary + verification log |
> GitHub PR review approval **or** `pm-verdict/v1` APPROVED comment
>
> **Merge Authority is defined once, mechanically, by
> `.github/workflows/merge-gate.yml`** (ratified 2026-05-18 for T2 …). For T2,
> the orchestrator's own `gh pr review --approve` after diff review satisfies
> the "GitHub PR review approval" branch — no PM presence or PM_VERDICT
> comment is mechanically required, for any executor (Claude or Codex).

**`.github/workflows/merge-gate.yml`** (T2 branch, comment at ~lines 220–229
and enforcement at ~lines 230–260):

> T2: pm-verdict/v1 is the canonical approval path (…, 2026-05-18) — GitHub
> PR review approval is also accepted. Either satisfies the gate.
>
> A third path (…) recognizes a valid EXECUTOR_RESULT/v1 comment from an
> AUTHORIZED_REVIEWERS member as sufficient self-attestation. This exists
> because GitHub blocks `gh pr review --approve` when the reviewing account is
> also the PR author — true for every executor in this repo, since Claude and
> Codex both open PRs under the same griff843 identity. CLAUDE.md already
> documents self-approval as intended to satisfy T2 with no PM presence
> required; this makes that mechanically possible instead of requiring an
> --admin merge for every T2 PR.

`AUTHORIZED_REVIEWERS` (merge-gate.yml, ~line 66) is
`new Set(['griff843'])` — a single GitHub identity matching
`.github/CODEOWNERS`. There is structurally no second identity in this repo
today that could produce an approval distinct from the PR's own author.

**`docs/05_operations/DELEGATION_POLICY.md`** (Tier B, line ~78):

> In practice: the orchestrator diff-reviews, applies `gh pr review
> --approve`, and merges on green CI, provided the PR touches no Tier C
> sensitive paths (see sensitive-path matrix).

**`docs/05_operations/OPERATING_MODEL_SONNET5.md`** (line 58):

> T2 merge is **not** [a Rule 9 stop condition] — per `merge-gate.yml`
> (ratified 2026-05-18, …) and Delegation Policy's Tier B model, the
> orchestrator diff-reviews and self-approves via `gh pr review --approve`;
> no PM presence or PM_VERDICT is mechanically required, for any executor.

### 1.3 The conflict, stated plainly

The Constitution's §2.8/§2.14/§9.3 language is unconditional — no tier
qualifier exempts T2. The ratified, currently-enforced T2 workflow has the
orchestrator implement a change, diff-review its own PR, and approve/attest
it under the same GitHub identity — implement, review, approve, and (via the
green Merge Gate) certify the same work. This is not an accidental gap: the
merge-gate comment says the design is *intended* to satisfy T2 with no PM
presence. That deliberateness is what makes it a live constitutional
contradiction rather than a bug to quietly patch.

---

## 2. What is already settled (out of scope here)

The T2 merge-authority **definition** — which document is authoritative, and
what the mechanical gate requires — was already reconciled by the ratified
merge-authority spec work (the merge-gate ratification of 2026-05-18, later
extended by the canonical merge-authority spec lane and the self-attestation
extension lane). Those lanes made `merge-gate.yml` the single mechanical
authority and rewrote `CLAUDE.md`, `DELEGATION_POLICY.md`,
`OPERATING_MODEL_SONNET5.md`, and `three-brain.md` to agree with it. That
question is **not** reopened here.

This packet is only the residual, narrower question those lanes did not
touch: whether the now-internally-consistent T2 self-approval workflow is
compatible with the Constitution's no-self-certification clauses — and if
not, which side moves.

---

## 3. Throughput data (grounding for the tradeoffs)

From lane manifests (`docs/06_status/lanes/*.json`, `status: done`,
`closed_at >= 2026-06-15` — last 30 days, counted at drafting time):

| Tier | Done lanes (30d) | Share |
|---|---|---|
| T2 | 108 | 62% |
| T1 | 38 | 22% |
| T3 | 27 | 16% |
| **Total** | **173** | |

Every one of those 108 T2 merges passed the merge gate via the
self-approval/self-attestation path or a PM verdict; since
`AUTHORIZED_REVIEWERS` contains a single identity, none had a structurally
independent approver. T2 is the **majority of all merge volume**. Any option
that adds a blocking human step to T2 is a change to the primary merge path,
not a marginal adjustment.

---

## 4. Options

### Option A — Repeal T2 self-approval (independent review required for all T2)

Remove the orchestrator self-approval and executor-result self-attestation
paths from the T2 branch of `merge-gate.yml`; T2 then requires a
`pm-verdict/v1` APPROVED comment (or a genuinely independent review) the same
way T1 does.

- **Safety:** Highest. Restores literal compliance with §2.8/§2.14 — no actor
  certifies its own T2 work.
- **Throughput:** Severe and quantified: 108 of 173 merges (62%) in the last
  30 days would move from orchestrator-paced to PM-paced. This recreates the
  exact PM-wait bottleneck the ratified T2 authority work was built to
  eliminate (its problem statement identified multi-hour cycle-time outliers
  as "all PM-wait"). With `AUTHORIZED_REVIEWERS` a single human identity,
  Tier B functionally collapses into Tier C.
- **Infrastructure:** None new — but it unwinds a ratified design rather than
  reconciling with it.

### Option B — Explicit constitutional T2 carve-out (codify current practice)

Amend the Constitution (a qualifier under §2.8/§2.14, anchored on §9.3's
existing "T2/T3 lanes may use lighter governance but must remain auditable")
to permit orchestrator self-approval **only for T2**, and only when all of
the following hold, mechanically:

1. green CI on the merge SHA (not just branch CI);
2. a valid `executor-result/v1` artifact on the PR;
3. file-scope-lock compliance (scope CI green, no scope bleed);
4. the PR touches no Tier C sensitive paths (per the Delegation Policy
   sensitive-path matrix — Tier C always escalates to PM).

- **Safety:** Resolves the textual contradiction without weakening any
  existing control; the four conditions above are all already mechanically
  enforced today, so the amendment codifies — and freezes — the current
  bounded practice rather than inventing a new permission. Honest cost: it
  adds no *new* control, and a carve-out written to bless existing behavior
  brushes against §2.8's "no workflow may self-authorize" — which is exactly
  why the amendment must be made by Griff, not by any agent (see §6 note on
  amendment authority). Compensating controls remain intact: Tier C
  escalation, Rule 9 stop conditions, `ops:truth-check` done-gate, and the
  auditable trail (PR reviews/comments + lane manifests) satisfying §9.3's
  "must remain auditable."
- **Throughput:** Zero impact. The 108-merges/30d T2 path is unchanged.
- **Infrastructure:** None. Documentation-level constitutional amendment only.

### Option C — Cross-executor review for T2 (implementer ≠ approver), no constitution change

Keep T2 orchestrator-paced but require the approving artifact to come from a
different executor/agent than the implementer (Codex reviews Claude's T2 PR
and vice versa), realizing the Constitution's own §14.3 Dual-Adversarial
Model as the T2 gate.

- **Safety:** Second-highest. Closes the literal self-certification gap with
  no human bottleneck; most aligned with constitutional text that already
  exists.
- **Throughput:** Moderate — machine-speed second-pass latency plus a second
  executor slot per T2 merge (real at 108 T2 merges/30d, but bounded by
  compute, not PM availability).
- **Infrastructure — the decisive gap:** Both executors act as the single
  `griff843` GitHub identity today. The merge gate cannot mechanically
  distinguish "Codex reviewed Claude's PR" from "the author attested its own
  PR" without provisioning a second authorized identity (distinct bot
  account/token) and extending `AUTHORIZED_REVIEWERS`/CODEOWNERS. Until that
  exists, Option C degrades in practice to Option B without the
  constitutional honesty — the words would claim independence the mechanism
  cannot verify.

---

## 5. Summary table

| Option | Safety vs §2.8/§2.14 | Throughput cost (108 T2 merges/30d) | New infrastructure |
|---|---|---|---|
| A — Repeal self-approval | Highest (literal compliance) | Severe — 62% of merge volume becomes PM-paced | None |
| B — Constitutional T2 carve-out | Textual reconciliation; existing mechanical conditions frozen into constitutional law | None | None |
| C — Cross-executor review | Second-highest, if verifiable | Moderate (machine-speed) | Second authorized GitHub identity — does not exist today |

---

## 6. Recommendation

**Option B**, for these reasons:

1. **A's cost is disproportionate to its demonstrated risk.** 62% of merge
   volume would re-acquire a single-human bottleneck to fix a textual
   contradiction, with no evidence in the last 30 days of a bad T2
   self-approved merge that independent review would have caught (the tier
   system, scope locks, Tier C path escalation, and truth-check exist
   precisely to bound T2 blast radius).
2. **C is the best end-state but is not honest today.** Without a second
   verifiable identity, "cross-executor review" is unverifiable theater —
   itself a §22 anti-pattern ("advisory-only governance presented as
   enforcement"). C is best treated as a possible future upgrade *after* a
   second identity is provisioned, layered on top of B's carve-out, not as
   the resolution of the contradiction now.
3. **B makes the Constitution true again without weakening anything.** The
   four carve-out conditions are already mechanically enforced; the amendment
   converts an undocumented divergence into a bounded, ratified exception —
   which is what invariant 11 ("if a rule can be enforced mechanically, it
   must not live only in prose") and §9.3's "lighter governance but
   auditable" language already gesture at.

**Authority note:** a constitutional amendment is **Griff-reserved
authority** (§2.8 "no automation may replace PM authority"; per the
standing governance rule, operating-model/gating changes take effect only
via a real governance PR ratified by PM). This packet recommends the
amendment; it does not and cannot enact it. The implementing lane, if B is
chosen, would be a Griff-ratified governance PR editing
`docs/00_constitution/UNIT_TALK_CONSTITUTION_V1.md` — explicitly out of this
lane's scope.

---

## 7. PM decision required

**Single decision for Griff:** choose the reconciliation direction —
**A** (repeal T2 self-approval and accept the 62%-of-volume PM-paced merge
path), **B** (ratify a constitutional amendment permitting orchestrator
self-approval for T2 only, conditioned on green CI on the merge SHA, a valid
executor-result artifact, file-scope-lock compliance, and no Tier C paths —
recommended), or **C** (fund a second authorized GitHub identity and require
cross-executor review for T2, deferring the constitutional text question
until that identity exists).

No other decision is requested by this packet.
