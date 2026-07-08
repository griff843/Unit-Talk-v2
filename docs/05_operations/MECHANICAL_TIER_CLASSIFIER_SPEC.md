# Mechanical Tier Classifier — Spec

Status: DRAFT — awaiting PM approval. Lane UTV2-1494 (spec only; implementation is a separate follow-up Codex lane per the issue).

This document is the Outcome Contract for UTV2-1494, posted verbatim to the Linear issue as a comment. It defines the path/diff-based mechanical tier classifier that will let CI derive a minimum required tier from a PR's actual diff, so a self-declared/manifest tier can never be the sole gate on required review.

---

## Issue

UTV2-1494 "Mechanical Tier Classification" (T1, `lane_type: governance`, executor `claude`, spec-only). This lane produces the Outcome Contract / spec document only. A follow-up lane (executor Codex, dispatched after PM approves this spec) will implement the actual classifier script and wire it into `merge-gate.yml`.

Related: UTV2-1451 (Tier C path guard self-authorization loophole) — same root cause (an agent's own declaration is the only gate), applied here to tier level rather than file scope. Fable 5 adversarial review finding.

## Objective

Define a mechanical, code-enforced minimum-tier classifier that derives a tier floor from the actual diff paths touched by a PR, so that a lane's self-declared/manifest tier can never be trusted as the sole gate. The classifier may only **raise** the effective tier above what was declared — it can never lower it. `merge-gate.yml` must consume `derived_tier = max(declared_tier, mechanical_minimum(diff))` when deciding which approval artifacts (T1 `t1-approved` + PM verdict, T2 PR-approval/pm-verdict, T3 auto-pass) are required.

## Why this matters

Today `merge-gate.yml` resolves `authoritativeTier` exclusively from the lane manifest's `tier` field (mirrored from a Linear label), which is declared by the same agent that opens the PR. Nothing mechanically checks that the declared tier matches the actual risk of the paths touched. `scripts/ops/merge-risk.ts` already contains a `TIER_C_EXACT_PATHS` / `TIER_C_PATH_PREFIXES` list, but it is used only for **cross-lane conflict detection** (`detectTierCConflict`), not for tier authorization at merge time — a PR can touch `packages/domain/src/**` while carrying a `T3`/`tier:T3` label and `merge-gate.yml` will auto-pass it on green CI with no PM verdict. This is the exact same class of failure as UTV2-1451 (Tier C path guard trusting self-declared file scope) but for tier level: a self-declared minimum with no mechanical floor is not a control, it is a suggestion. Fable 5 flagged this as adversarially exploitable — an agent (or a bug in tier assignment) can quietly downgrade a T1-risk change to T3 and it merges on green CI alone.

## Success criteria

- A written spec (this document) fully defines: path/diff rule table, the monotonic-max derivation algorithm, the merge-gate integration point, and concrete regression test cases — sufficient for Codex to implement without further design decisions.
- Spec explicitly proves the "never lower" property algorithmically (max function, not override/replace).
- Spec enumerates all path categories named in the acceptance criteria (Tier C paths, migrations, runtime, scoring, dispatch, governance, auth/security, env/config, schema-sensitive) with concrete glob/regex patterns tied to real paths in this repo.
- Spec defines regression test cases in enough detail that Codex can write the actual test file directly from this document.
- Spec states explicitly that T1/T2/T3 semantics are unchanged — the classifier adds a floor, not a redefinition.
- PM has approved the spec (via `pm-verdict/v1` or explicit chat approval per governance-change PR gate norms) before any implementation lane opens.

## Forbidden actions

- No code, script, or workflow file may be created or modified in this lane — this is spec-only.
- No modification of `merge-gate.yml`, `scripts/ops/merge-risk.ts`, `scripts/ci/r-level-check.ts`, or any other runtime/CI file.
- No modification of `docs/05_operations/DELEGATION_POLICY.md` (self-amendment requires PM regardless of diff size — this spec may *propose* changes to it but must not edit it directly).
- No re-tiering of UTV2-1494 itself, and no scope-widening to include the implementation (that is explicitly deferred to a follow-up Codex lane per the issue).
- No fabricated "already implemented" claims — the spec must not assert current mechanical enforcement exists where it does not (e.g. must not claim `merge-risk.ts`'s `TIER_C_*` lists already gate merge authorization — they currently only gate cross-lane conflict detection).
- Do not lower any existing required check or approval artifact in the process of describing the new one.

## Likely touched areas

**This SPEC lane touches only:**
- `docs/05_operations/MECHANICAL_TIER_CLASSIFIER_SPEC.md` (this document)

**A FUTURE implementation lane (Codex, after PM approval) would touch:**
- `.github/workflows/merge-gate.yml` — add a step/job that computes `derived_tier` before the tier-branch logic (T1/T2/T3) currently keyed on `authoritativeTier` alone
- New `scripts/ops/tier-classifier.ts` (co-located with `scripts/ops/merge-risk.ts`, which already owns the `TIER_C_EXACT_PATHS`/`TIER_C_PATH_PREFIXES` constants — the classifier should import/share these rather than duplicate them, to avoid drift with UTV2-1451's file-scope-lock work)
- New test file, e.g. `scripts/ops/tier-classifier.test.ts` (co-located per existing test conventions in `scripts/ops/`)
- `docs/05_operations/r1-r5-rules.json` — cross-reference only if the classifier's rule IDs are meant to align with R1-R5 path rules (they are a different axis — R-levels are verification depth, tier is merge authority — but both key off similar sensitive paths, so the spec should note the relationship, not merge the schemas)
- `docs/05_operations/DELEGATION_POLICY.md` — the sensitive-path matrix should be updated to reference the mechanical classifier as the enforcement mechanism, with PM approval, in the follow-up lane
- `docs/05_operations/LANE_MANIFEST_SPEC.md` — no change expected (manifest `tier` field remains the declared/floor input to `max()`; no schema change needed)

## PM gates required

Per `CLAUDE.md` and `docs/05_operations/DELEGATION_POLICY.md`, governance changes are never authorized by a chat message alone. This applies at two points:

1. **This spec lane (now):** The populated spec must be opened as a real PR (not merged from chat) and requires PM sign-off before it is considered ratified. Given `lane_type: governance` and `tier: T1`, merge authority per `merge-gate.yml` requires **both** the `t1-approved` label **and** a `pm-verdict/v1` APPROVED comment from a CODEOWNERS member (`docs/05_operations/schemas/pm-verdict-v1.md`) — a chat approval does not satisfy this gate mechanically.
2. **Before any follow-up implementation lane opens:** PM must explicitly approve this spec's content (the rule table, the max-derivation algorithm, and the regression test list) as the authoritative design. The follow-up Codex lane's dispatch packet must cite the PM-approved spec, not a chat paraphrase of it.
3. Per Delegation Policy Tier C rules, any future edit to `DELEGATION_POLICY.md`'s sensitive-path matrix or to `merge-gate.yml`'s tier-branch logic is Tier C — plan approval and merge approval both required, regardless of diff size.

## Required proof

- The populated spec document itself, committed to `docs/05_operations/MECHANICAL_TIER_CLASSIFIER_SPEC.md`, is the primary deliverable/proof.
- A T1 lane requires an evidence bundle per `/t1-proof` skill norms; for a spec-only lane with no runtime surface, the evidence bundle should record: diff scope (doc-only), that no code/workflow files were touched, and a link to the PM verdict once posted.
- No `pnpm test:db`, R2/R3/R4 artifacts, or runtime proof apply — there is no runtime behavior to prove (see Runtime validation below). The evidence bundle should state this explicitly rather than omit the section, so proof-coverage checks don't silently fail looking for a runtime verification file that will never exist for this lane.

## Runtime validation

N/A. This lane produces only a specification document (`docs/05_operations/MECHANICAL_TIER_CLASSIFIER_SPEC.md`). No code executes, no CI behavior changes, no merge-gate behavior changes as a result of this lane. Runtime validation applies to the future Codex implementation lane, not to this spec lane.

## Stop conditions

- If, during drafting, it becomes clear the rule table would need to diverge from `scripts/ops/merge-risk.ts`'s existing `TIER_C_EXACT_PATHS`/`TIER_C_PATH_PREFIXES` in a way that creates two competing definitions of "Tier C path" — stop and flag to PM rather than silently picking one, since UTV2-1451's file-scope-lock mechanism must not drift from this classifier's escalation table.
- If the spec's design would require changing today's T1/T2/T3 *meaning* (not just adding a floor) — stop, this is out of scope per the acceptance criteria ("preserve existing T1/T2/T3 semantics unless explicitly changed by PM").
- If scope pressure emerges to also implement the classifier in this lane — stop; this issue is explicitly spec-only, implementation is a separate Codex-executed follow-up lane per the Linear issue.
- If Linear state or this spec file conflicts with what's found in `merge-risk.ts`/`merge-gate.yml` (e.g. an assumption that enforcement already exists) — stop and report the discrepancy rather than writing around it.

## Recommended executor

Claude (Sonnet 5), for this spec lane — per `/three-brain` executor-selection rules, T1 + Tier C + governance-scoped planning defaults to Claude/Sonnet 5, with Opus reserved for adversarial critique review rather than routine T1 spec authorship. The follow-up implementation lane (script + workflow wiring + tests) should be dispatched to Codex CLI once this spec carries a PM verdict, per the issue's own routing ("Codex will implement the actual classifier in a follow-up lane after PM approves this spec").

## Invariants at risk

- **No self-declared downgrade may reduce required review** — the core invariant this whole lane exists to eventually enforce. The spec must make the monotonic-max property unambiguous so the follow-up implementation cannot accidentally implement `derived_tier = declared_tier` with escalation as an optional add-on (which would reintroduce the exact loophole).
- **T1/T2/T3 semantics stability** — existing lanes, docs, and tooling (`preflight.ts`, `truth-check.ts`, `r-level-check.ts`, `DELEGATION_POLICY.md`) all assume today's tier meanings. The spec must not silently redefine what T1/T2/T3 *mean*, only add a mechanical floor for what tier a diff must be treated as.
- **Tier C path list single-sourcing** — `merge-risk.ts` already owns `TIER_C_EXACT_PATHS`/`TIER_C_PATH_PREFIXES` for cross-lane conflict detection (UTV2-1451's domain). If the follow-up implementation defines a second, slightly different list for tier escalation, the two mechanisms will drift and re-open exactly the class of loophole both issues exist to close.
- **Merge-gate backward compatibility** — `merge-gate.yml`'s current tier resolution (`authoritativeTier` from manifest only) is a hard dependency for every currently in-flight lane. The spec must describe how a mechanical minimum-tier check is introduced without breaking lanes that opened PRs before the classifier existed (e.g. should it be advisory-first, or immediately blocking — this is a PM decision the spec should surface explicitly, not resolve unilaterally).

## Implementation approach

This section is the substantive design content for the follow-up Codex implementation lane.

### 1. Path-pattern rule table (mechanical minimum-tier by category)

Each rule maps a path pattern to a **minimum tier floor**. A diff's mechanical minimum is the maximum floor across all matched rules (T1 > T2 > T3 ordering).

| Category | Path patterns | Minimum tier floor | Rationale |
|---|---|---|---|
| Migrations | `supabase/migrations/**` | T1 | DDL is irreversible/high-blast-radius; already Tier C in `DELEGATION_POLICY.md` |
| Schema-sensitive / generated types | `packages/db/src/database.types.ts` | T1 | Generated from migrations; hand-edits or silent drift are a correctness risk |
| Runtime execution / lifecycle | `packages/db/src/lifecycle.ts`, `packages/db/src/repositories.ts`, `packages/db/src/runtime-repositories.ts`, `apps/api/src/distribution-service.ts`, `apps/api/src/submission-service.ts`, `apps/api/src/settlement-service.ts`, `apps/api/src/*-service.ts` (outbox/delivery/settlement-named services), `apps/worker/**` | T1 | Write authority, state machine, delivery/settlement correctness |
| Scoring / model / domain logic | `packages/domain/src/**` (includes `packages/domain/src/models/**`, `packages/domain/src/features/**`, `packages/domain/src/promotion/**`, `packages/domain/src/grading/**`, `packages/domain/src/clv/**`, `packages/domain/src/strategy/**`) | T1 | Pure business/scoring logic; already Tier C per `DELEGATION_POLICY.md` |
| Cross-package contracts | `packages/contracts/src/**` | T1 | Canonical shared contracts; already Tier C |
| Dispatch / lane orchestration | `scripts/ops/lane-*.ts`, `scripts/ops/merge-*.ts`, `scripts/ops/tier-*.ts`, `scripts/ops/orchestration-reconciler.ts`, `.github/workflows/*.yml` (any workflow that changes required checks) | T1 | Governs how all other work is authorized/merged — a compromise here compromises every tier |
| Governance docs | `docs/00_constitution/**`, `docs/05_operations/*_POLICY.md`, `docs/05_operations/*_SPEC.md`, `docs/05_operations/DELEGATION_POLICY.md` | T1 | Self-amendment of the rules that govern authorization |
| Auth / security | `apps/api/src/auth.ts`, any RBAC/route-protection file, any file touching credentials, RLS policy text, service-role key handling | T1 | Security posture change; already an "always-escalate" category in `DELEGATION_POLICY.md` |
| Env / config | `.env*`, `local.env`, `packages/config/**` | T1 | Configuration surface is PM-only per `DELEGATION_POLICY.md` "always-escalate" list |
| Everything else (docs/06_status, .claude/**, scripts/ci helper scripts, test-only files) | (no match) | No floor — declared tier stands | Bounded, low-risk, or already covered by other gates (proof-coverage-guard, R-level check) |

Note: this table should be implemented as a **shared constant module** (e.g. exported from `scripts/ops/merge-risk.ts` or a new `scripts/ops/tier-paths.ts` imported by both `merge-risk.ts` and the new `tier-classifier.ts`) so UTV2-1451's Tier C path guard and this tier-escalation classifier read from one source of truth. Divergence between "what Tier C path guard blocks" and "what tier classifier escalates" is the single largest risk identified in this spec (see Risk flags).

### 2. Derivation algorithm

```
declared_tier = manifest.tier                    // T1 | T2 | T3, from lane manifest (authoritative declared value)
touched_paths = diff.changedFiles(base, head)     // git diff --name-only, same mechanism as r-level-check.ts
mechanical_minimum = max( floor(p) for p in touched_paths if floor(p) exists, default: T3 )
derived_tier = max(declared_tier, mechanical_minimum)   // tier ordering: T1 > T2 > T3
```

`max()` here is over the ordinal ranking `T1=3, T2=2, T3=1` (or equivalent), and is **strictly monotonic non-decreasing**: `derived_tier` can never be numerically less than `declared_tier`. There is no code path that takes `min()`, no override flag, no "trusted executor" bypass. This is the single property that closes both UTV2-1451 and UTV2-1494's class of loophole: mechanical signal can only add friction, never remove it.

Declared tier is **not** downgraded by the classifier either — if a lane declares T1 but only touches T3-eligible paths, `derived_tier` stays T1 (`max(T1, T3) = T1`). The classifier is a floor-raiser in both directions of the `max()`, not a re-classifier. Manifest/Linear-declared tier remains the authority for anything the mechanical table doesn't reach.

### 3. Merge-gate integration point

In `.github/workflows/merge-gate.yml`, insert the derivation as a step immediately after the existing "resolve authoritative tier from lane manifest" block and before the T3 auto-pass branch:

1. Compute `touched_paths` via `git diff --name-only ${baseSha}...${headSha}` (same mechanism `r-level-check.ts` already uses).
2. Run the shared rule table against `touched_paths` to get `mechanical_minimum`.
3. Compute `derived_tier = max(authoritativeTier, mechanical_minimum)`.
4. Replace all subsequent uses of `tier = authoritativeTier` with `tier = derived_tier`.
5. If `derived_tier !== authoritativeTier` (i.e. mechanical escalation occurred), emit a check-run annotation stating which path(s) triggered escalation and require the label/verdict artifacts for the **escalated** tier, not the declared one — e.g. a PR labeled `tier:T3` that touches `packages/domain/src/**` must now satisfy T1's `t1-approved` + `pm-verdict/v1` requirements before merging, and the workflow should auto-correct/replace the stale `tier:T3` label the same way it already auto-applies a missing tier label today.
6. This is a **required check**; if `derived_tier` requirements are unmet, the gate fails (same failure path as today's existing tier-validation failure handling).

### 4. Concrete regression test cases (for the future test file)

1. PR touching only `docs/06_status/lanes/*.json` stays at declared tier (no escalation) — asserts the "everything else" default doesn't over-trigger.
2. PR touching `supabase/migrations/0123_add_column.sql` is forced to at least T1 regardless of a declared `tier:T3` label.
3. PR touching `packages/domain/src/models/scoring.ts` is forced to at least T1.
4. PR touching `packages/contracts/src/submission.ts` is forced to at least T1.
5. PR touching `apps/worker/delivery-adapter.ts` is forced to at least T1.
6. PR touching `.env.example` or adding a new key to `packages/config/**` is forced to at least T1.
7. PR declaring T1 but touching only a T3-eligible path (e.g. `scripts/ci/some-helper.ts`) is **not** downgraded to T3 — `derived_tier` stays T1 (declared tier is a floor from the manifest side too; only escalation is mechanical, never de-escalation).
8. Multi-path PR touching both a T3-eligible path and a `packages/domain/src/**` path takes the max across all matched rules (T1 wins).
9. PR touching `docs/05_operations/DELEGATION_POLICY.md` is forced to at least T1 (governance doc self-amendment).
10. PR touching `.github/workflows/merge-gate.yml` itself is forced to at least T1 (dispatch/orchestration category) — this is the classifier protecting its own enforcement mechanism from being weakened without T1 review.
11. PR touching a path not in any rule (e.g. `apps/command-center/src/Widget.tsx`) computes `mechanical_minimum = T3` and leaves `derived_tier` exactly equal to `declared_tier`.
12. Declared tier missing/invalid (no manifest, as already handled by existing merge-gate logic) — classifier does not mask this pre-existing hard failure; it only applies once `declared_tier` is resolved.

### 5. T1/T2/T3 semantics preservation

This classifier changes **no** existing definition of what T1, T2, or T3 *mean* in terms of required proof, ceremony, or approval artifacts (per the table in `CLAUDE.md` / `DELEGATION_POLICY.md`). It changes only **which tier a given diff is evaluated against** at merge time. A PR correctly declared T1 today behaves identically after this change. The only behavior change is for PRs whose declared tier under-states the risk of their actual diff — those are now mechanically forced up to the correct tier's existing requirements, not given new requirements that don't exist today.

## Risk flags

- **Overly broad globs risk grinding velocity to a halt.** `packages/domain/src/**` and `apps/worker/**` are broad prefixes; if a T3-eligible doc fix or test-only change happens to live under one of these directories, it would be force-escalated to T1 unnecessarily. The follow-up lane should consider file-extension/kind exclusions (e.g. `*.test.ts` under a T1 prefix might still warrant T1 review since tests can hide behavior changes — this is a judgment call for PM, flagged here rather than resolved).
- **Overly narrow globs recreate the loophole.** If the rule table omits a real runtime-risk path (e.g. a new `apps/api/src/*-service.ts` file that isn't yet enumerated, or a new package under `packages/` doing scoring work), that path silently gets no mechanical floor and the declared tier is trusted again — exactly the failure mode this issue exists to close. The table must be treated as a living document requiring updates whenever new runtime/domain paths are introduced, and ideally validated by a meta-test that fails if `packages/domain/src/**` or `apps/worker/**` gain new top-level subdirectories not covered by the shared constant.
- **Duplication/drift risk with UTV2-1451's Tier C path guard.** `scripts/ops/merge-risk.ts` already defines `TIER_C_EXACT_PATHS`/`TIER_C_PATH_PREFIXES` for a different purpose (cross-lane file-scope conflict detection). If the tier-classifier implementation (Codex, follow-up lane) defines its own separate list instead of importing/sharing this one, the two "what counts as sensitive" definitions will diverge over time, silently reopening gaps in one mechanism while the other is updated. This spec recommends a single shared constant module; the follow-up lane's plan approval should explicitly confirm this sharing is implemented, not just described.
- **Backward compatibility for in-flight lanes.** Multiple lanes likely have open PRs with `declared_tier` already set and possibly already reviewed. If `merge-gate.yml`'s new derivation logic goes live mid-flight, previously-approved-as-T3 PRs that touch e.g. `packages/domain/src/**` would suddenly need `t1-approved` + PM verdict artifacts they never obtained, blocking merges that were otherwise ready. The follow-up implementation lane should decide (with PM) whether to (a) ship as advisory/warning-only for N days before making it a hard-blocking required check, or (b) hard-block immediately with a documented one-time PM sweep to re-approve any currently-open PRs that get escalated. This decision belongs to PM at plan-approval time for the implementation lane, not to this spec.
- **Governance doc category is self-referential.** Escalating changes to `docs/05_operations/*_POLICY.md`/`*_SPEC.md` to T1 means this very classifier's own spec and its own future code changes will need T1 treatment going forward — this is intentional (prevents the classifier from being weakened by a low-tier PR) but should be called out explicitly so it isn't perceived as an oversight later.

### Critical files for implementation

- `docs/05_operations/MECHANICAL_TIER_CLASSIFIER_SPEC.md` (this document)
- `scripts/ops/merge-risk.ts`
- `.github/workflows/merge-gate.yml`
- `docs/05_operations/DELEGATION_POLICY.md`
- `docs/05_operations/r1-r5-rules.json`
