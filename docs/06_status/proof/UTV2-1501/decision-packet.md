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

An `executor-result/v1` artifact is the implementer's readiness statement.
Validation can establish its shape, authorization, and current-head binding;
it cannot turn that statement into independent review or owner approval.
Likewise, commits and comments made through the shared `griff843` credential
do not prove that Griff personally reviewed the work. This packet and its
proof bundle are executor-produced evidence only, not independent
certification and not a substitute for the T1 owner artifacts.

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

## 2. Related live policy contradiction (not resolved by this packet)

The mechanical T2 gate is defined by `.github/workflows/merge-gate.yml`, but
the surrounding policy prose is **not fully reconciled**. In particular,
`docs/05_operations/DELEGATION_POLICY.md` currently says both:

- in its Tier B opening paragraph, that the orchestrator may diff-review,
  approve, and merge a T2 PR on green CI without PM presence; and
- in the Tier B **Merge policy** paragraph, that the PR body must say
  "awaiting PM merge approval" and that the orchestrator must not merge until
  PM explicitly approves in the session.

Those statements cannot both govern the same T2 merge. This packet does not
edit the Tier C `DELEGATION_POLICY.md` path and therefore does not resolve that
separate policy defect. Any implementation of the decision in this packet
must also reconcile that contradiction through an owner-ratified governance
change. Until then, the stricter PM-approval statement must not be described
as having been superseded merely because the workflow admits another path.

The narrower constitutional question remains: whether the mechanically
accepted T2 self-attestation path is compatible with the Constitution's
no-self-certification clauses, and, if not, which side moves.

---

## 3. Throughput implications (limitations stated)

This packet does not claim a verified 30-day tier distribution or merge
outcome rate. Lane-manifest counts alone are not sufficient evidence for
those claims: manifests can be stale, a `done` lane is not itself proof of a
merge path, and determining which approval artifact satisfied a historical
merge requires a PR-by-PR audit of comments, reviews, checks, head SHAs, and
merge commits.

The defensible conclusion is qualitative: T2 is designed as the normal path
for bounded service and integration work, so adding a mandatory PM step would
reduce autonomy and may add queue latency. The size of that effect is
**unmeasured by this lane**. Likewise, this packet makes no claim that all
historical T2 lanes had valid self-attestation, independent approval, or
owner verdict evidence.

---

## 4. Options

### Option A — Repeal T2 self-approval (independent review required for all T2)

Remove the orchestrator self-approval and executor-result self-attestation
paths from the T2 branch of `merge-gate.yml`; T2 then requires a
`pm-verdict/v1` APPROVED comment (or a genuinely independent review) the same
way T1 does.

- **Safety:** Highest. Restores literal compliance with §2.8/§2.14 — no actor
  certifies its own T2 work.
- **Throughput:** Potentially material but not quantified by this packet.
  The bounded T2 path would move from orchestrator-paced to independent-review
  paced. With `AUTHORIZED_REVIEWERS` containing a single shared identity,
  owner review is the only currently distinguishable approval identity.
- **Infrastructure:** None new — but it unwinds a ratified design rather than
  reconciling with it.

### Option B — Explicit constitutional T2 carve-out (codify current practice)

Amend the Constitution (a qualifier under §2.8/§2.14, anchored on §9.3's
existing "T2/T3 lanes may use lighter governance but must remain auditable")
to permit orchestrator self-approval **only for T2**, subject to explicitly
specified controls. The current repository provides relevant mechanisms, but
it does **not** prove the four-condition package below as a single existing,
end-to-end enforcement invariant:

1. PR-head CI and, where the merge queue is used, merge-group checks;
2. an `executor-result/v1` comment validated against the current PR head SHA;
3. file-scope-lock CI for the evaluated PR head and issue scope;
4. tier/path classification that escalates Tier C-sensitive changes.

Post-merge proof binding is a distinct closeout control: the actual merge
commit SHA does not exist until after merge. It must not be conflated with
PR-head review evidence or merge-group CI. If Griff chooses B, the
implementing plan must define which of these checks are required branch
protection contexts, what event/SHA each check evaluates, and how the actual
merge commit is bound during truth-close.

- **Safety:** Could resolve the textual contradiction without weakening the
  intended controls, but only after the implementation lane verifies and
  closes the enforcement gaps above. The present workflow contains pieces of
  the proposed control set; this packet does not certify that they are all
  required, evaluate the same SHA, or jointly fail closed. Honest cost: a
  carve-out written to bless existing behavior
  brushes against §2.8's "no workflow may self-authorize" — which is exactly
  why the amendment must be made by Griff, not by any agent (see §6 note on
  amendment authority). Compensating controls remain intact: Tier C
  escalation, Rule 9 stop conditions, `ops:truth-check` done-gate, and the
  auditable trail (PR reviews/comments + lane manifests) satisfying §9.3's
  "must remain auditable."
- **Throughput:** Intended to preserve the current T2 operating model; exact
  impact depends on any enforcement repairs required by the implementation.
- **Infrastructure:** None. Documentation-level constitutional amendment only.

### Option C — Cross-executor review for T2 (implementer ≠ approver), no constitution change

Keep T2 orchestrator-paced but require the approving artifact to come from a
different executor/agent than the implementer (Codex reviews Claude's T2 PR
and vice versa), realizing the Constitution's own §14.3 Dual-Adversarial
Model as the T2 gate.

- **Safety:** Second-highest. Closes the literal self-certification gap with
  no human bottleneck; most aligned with constitutional text that already
  exists.
- **Throughput:** Moderate in design — machine-speed second-pass latency plus
  a second executor slot per T2 merge, bounded by compute and review capacity
  rather than PM availability. This lane does not quantify that load.
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

| Option | Safety vs §2.8/§2.14 | Throughput cost | New infrastructure |
|---|---|---|---|
| A — Repeal self-approval | Highest (literal compliance) | Potentially material; not quantified here | None |
| B — Constitutional T2 carve-out | Textual reconciliation after control verification | Intended to preserve current flow | None necessarily; enforcement repair may be required |
| C — Cross-executor review | Second-highest, if verifiable | Moderate (machine-speed) | Second authorized GitHub identity — does not exist today |

---

## 6. Recommendation

**Option B**, for these reasons:

1. **A changes the intended bounded-work operating model.** It would add an
   independent-approval dependency to every T2 merge. This lane has not
   audited enough historical PR evidence to quantify the latency impact or
   claim an absence of bad self-approved merges.
2. **C is the best end-state but is not honest today.** Without a second
   verifiable identity, "cross-executor review" is unverifiable theater —
   itself a §22 anti-pattern ("advisory-only governance presented as
   enforcement"). C is best treated as a possible future upgrade *after* a
   second identity is provisioned, layered on top of B's carve-out, not as
   the resolution of the contradiction now.
3. **B can make the Constitution and intended operating model agree, but it
   is conditional.** Before amendment, the implementation packet must map
   each promised control to a required check, its trigger event, and its SHA;
   reconcile the live Delegation Policy contradiction; and preserve
   post-merge truth-close as distinct from pre-merge approval. Griff would
   then ratify a bounded exception with its actual enforcement surface known.

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
**A** (repeal T2 self-approval and accept a PM/independent-review-paced merge
path), **B** (recommended direction: first reconcile the Delegation Policy
and verify exact PR-head, merge-group, tier/path, and post-merge controls;
then ratify a bounded constitutional T2 exception), or **C** (fund a second
authorized GitHub identity and require
cross-executor review for T2, deferring the constitutional text question
until that identity exists).

Approval of this analysis packet does not itself select B, amend the
Constitution, repair the Delegation Policy, or authorize a workflow change.
