# Deployment Truth Design

**Status:** Draft — pending adversarial design review (Codex) before any implementation
**Issue:** UTV2-1666
**Supersedes:** UTV2-1666's original ad hoc problem statement
**Authority:** Governs `deploy.yml` (canary + promote jobs) and `scripts/ops/readiness-refresh.ts`'s `deploy_sha_alignment` dimension

---

## 0. Why this document exists

UTV2-1660 (PR #1365) discovered the same two bug shapes at progressively deeper layers across 23 review rounds, each found reactively by the next round rather than generalized after the first occurrence:

1. **Aggregate status conflates unrelated sub-outcomes** — a DB row count, a workflow's overall `conclusion`, and a job's own `conclusion` each covered more ground than the one specific fact being trusted from it (rounds 20, 21, 22).
2. **Evidence emitted after-the-fact has a loss window** — writing proof of a mutation *after* the mutation succeeds means a crash between the two events leaves a real mutation with no evidence (round 23).

Per PM decision (2026-08-02), further reactive patching of this lane stops. This document is the single, holistic design that must resolve every open truth-gap in one pass, reviewed adversarially *as a design* before any code changes it. `UTV2-1666`'s implementation is "build this document," not "patch the next finding."

---

## 1. Authoritative production-mutation evidence

**Principle:** the fact "production is now running tag `X`" must be provable from a signal that is written *atomically with* the mutation itself, not synthesized afterward from a job's/workflow's/run's aggregate status.

Two evidence channels, in priority order:

1. **Host-side receipt (authoritative).** Written on the deploy host itself, in the *same* SSH round-trip that performs the mutation — see §5.
2. **GitHub Actions artifact (transport/cache).** A same-run artifact carrying the same fields, uploaded for cheap querying by `readiness-refresh.ts` without needing SSH access. It is a *copy* of the host-side fact, never the sole source of truth once §12 (live host reconciliation) ships.

Neither channel is a job/workflow *conclusion*. `probeDeploySha` must never read `run.conclusion`, `run.status`, or any job's conclusion field when deciding whether a mutation occurred — those fields are removed from consideration entirely, not merely deprioritized.

## 2. All refs, including non-main `workflow_dispatch`

`deploy.yml`'s `workflow_dispatch` trigger carries no `branches:` restriction (confirmed: `.github/workflows/deploy.yml`). Evidence discovery (`GithubReader.listRunsByRecency('deploy.yml')`) must never pass a `branch` filter — round 23 already landed this for `probeDeploySha`; this document ratifies it as a standing invariant, not a one-off fix. `resolveParkedContractReceipt`'s equivalent discovery already does this (round 8).

## 3. Workflow runs and rerun attempts

GitHub Actions reruns are per-*attempt*, not per-run: a failed-jobs-only rerun of a downstream job (e.g. `smoke`) advances a run's `run_attempt` without re-executing the mutation step. Evidence must be keyed to `(run_id, run_attempt)`, and discovery must search every attempt of a candidate run (current down to 1) before moving to an older candidate — this part of rounds 12/14/15/16's design is correct and carries forward unchanged. What changes is *what* is being searched for at each attempt: a host-side/artifact receipt (§1), never a job conclusion.

## 4. Pre-mutation intent

Before any remote mutation command runs, the workflow writes a **pre-mutation intent** record to the host, atomically (temp file + `mv`), containing:

```json
{
  "schema": "deploy-mutation-intent/v1",
  "run_id": "...",
  "run_attempt": "...",
  "requested_tag": "...",
  "intent_recorded_at": "..."
}
```

This captures "a mutation to this tag was about to be attempted" *before* `docker compose up -d` runs, so that a runner cancellation or connectivity loss during or immediately after the mutation attempt leaves a durable trace even if the terminal confirmation (§5) never gets written. The intent record is not itself proof of a completed mutation — see §13 for how the absence of a matching terminal receipt is scored.

## 5. Host-side mutation confirmation

Immediately after `docker compose up -d --remove-orphans` succeeds, in the **same** `ssh ... "set -eu && ..."` command block (not a later step, not a later SSH call), the remote script writes a **mutation-confirmed** record next to the existing `.unit-talk-release` file:

```json
{
  "schema": "deploy-mutation-confirmed/v1",
  "run_id": "...",
  "run_attempt": "...",
  "deployed_tag": "...",
  "confirmed_at": "..."
}
```

Because this write is inside the same `set -eu` block as the mutation, if the write itself fails the whole SSH command returns non-zero — the runner-side caller must treat *any* non-zero exit from this combined command as "mutation status unknown," never as "mutation definitely did not happen" (the containers may have already been replaced before the write failed) and never as "mutation definitely happened" (the write failing could also mean the mutation itself never got that far). This is intentionally the same fail-closed posture as §13.

## 6. Runner cancellation or connectivity loss after mutation

Covered by §4 + §5 together: if the runner is cancelled or loses connectivity *after* the SSH mutation command returns to it, the host-side confirmation (§5) already landed (SSH already completed server-side) and is independently readable via §12. If the runner is cancelled *before* the SSH command completes at all, only the intent record (§4) exists, and §13's fail-closed rule applies. There is no scenario in this design where a genuine mutation is invisible to every evidence channel simultaneously — that gap is exactly what §4+§5 exist to close, replacing the current single-channel ("GitHub artifact only") design that has it.

## 7. Artifact upload failure

If the host-side confirmation (§5) succeeded but the *subsequent* GitHub Actions artifact upload fails (network blip, Actions service issue), the host-side record is still authoritative and still readable via §12 (live host reconciliation). Until §12 ships (see §14, phasing), this specific sub-case is a **named, accepted gap**: `readiness-refresh.ts` currently has no host SSH access and can only read the GitHub artifact copy. This is not silently unhandled — it is explicitly scoped as follow-up work, the same way the original round-1 P2 (30-day artifact retention expiry) was named and tracked rather than fixed inline.

## 8. Explicit image tags

The evidence record's `deployed_tag`/`requested_tag` field is read directly from the record, never re-derived from `run.head_sha`. This matters because `IMAGE_TAG: ${{ inputs.image_tag || github.sha }}` means a manual dispatch with an explicit `image_tag` input can differ from the run's own commit SHA — trusting `head_sha` blindly (the pre-round-22 design) would misreport the deployed tag for any such dispatch. `probeDeploySha`'s `deployed_sha`/alignment comparison uses the record's own tag field, matching the round-22 mutation-receipt design already landed.

## 9. Successful, failed, and absent rollback

`deploy/rollback.sh`'s remote command has the *identical* mutate-then-confirm shape as the forward path (`cp .unit-talk-release .unit-talk-release.failed` → write new tag → `docker compose pull` → `docker compose up -d`, all under `set -eu`). Rollback therefore needs the same two-phase evidence as the forward mutation, symmetric to §4/§5:

- **Rollback intent**, written before `rollback.sh`'s remote command runs.
- **Rollback-confirmed** record, written inside `rollback.sh`'s own `set -eu` block immediately after its `docker compose up -d` succeeds.

Three cases, all requiring explicit test coverage (§14):

| Case | Evidence state | Authoritative tag |
|---|---|---|
| Rollback **succeeds** | rollback-intent + rollback-confirmed both present, confirmed timestamp later than the original mutation-confirmed | `rolled_back_to_tag` — supersedes the original mutation |
| Rollback **fails** (script exits non-zero, e.g. `docker compose pull` fails on the rollback tag) | rollback-intent present, rollback-confirmed absent | Whole dimension → `unknown` per §13 (a rollback was attempted; host state cannot be assumed) — **not** silently falling back to the original mutation-confirmed record |
| Rollback **absent** (no `rollback_tag` input supplied, health-check simply exits 1 with no rollback attempted) | no rollback-intent at all | Original mutation-confirmed record stands unchallenged |

The "rollback fails → unknown, not fallback" rule is the single most important correctness property in this document: it is the direct fix for treating "we don't know" as if it were "the old answer is still true," the exact failure mode this whole design exists to close.

## 10. Evidence ordering and timestamps

All cross-run/cross-attempt comparisons order by the evidence record's own `confirmed_at` (or `rolled_back_at`) timestamp — never by run-level `updated_at`, never by job `completed_at`, never by artifact `created_at`. This generalizes round 16's fix (compare by the promote job's own completion time) to the new evidence shape. Timestamp comparisons use parsed epoch values (the existing `isAfter()` helper), never lexical string comparison (round 9's fix, unchanged).

## 11. Artifact retention and expiry

GitHub artifacts expire (`retention-days: 30`, matching the existing `parked-contract-receipt`/`deploy-mutation-receipt` pattern). A deployment older than the retention window with no newer deploy since becomes `unreadable` via the artifact channel — this is the original round-1 P2, formally named here rather than re-discovered. Once §12 ships, live host reconciliation provides a retention-independent fallback (the host's `.unit-talk-release`/confirmation files don't expire); until then this remains an accepted, explicitly-tracked gap, not a silent one.

## 12. Live host reconciliation

**This is a new capability, not present in any prior round, and requires explicit PM sign-off before implementation** because it means granting `readiness-refresh.ts`'s execution context read-only SSH access to the production deploy host — a real, new secret-exposure surface distinct from its current Supabase/`gh` credentials.

Proposed shape: a read-only `HostReader` capability (`readHostReleaseState(): Promise<{ tag: string; confirmedAt: string } | null>`) that SSHs to the deploy host and reads back `.unit-talk-release` + the mutation-confirmed/rollback-confirmed JSON files directly — the same read `deploy.yml`'s own "Confirm syndicate machine gate" step already performs, reused as a readiness-side capability instead of a deploy-time-only one. Used to:

- Cross-verify the GitHub-artifact-derived answer against ground truth, flagging disagreement as `unreadable` rather than silently trusting either side.
- Serve as the sole evidence path when the artifact channel is unavailable (§7, §11).

**Open decision for PM:** whether readiness-refresh's execution environment (a scheduled/dispatched GitHub Actions job) is an acceptable place to hold read-only deploy-host SSH credentials, or whether this capability should instead live in a separate, more tightly-scoped job/service. Flagging this explicitly rather than deciding it implicitly during implementation is itself an application of the operating-model change requested — architectural questions get decided before code, not discovered as a review finding.

## 13. Fail-closed UNKNOWN versus confirmed drift/failure

Three-way classification, replacing the current two-way (trust-this-candidate / reject-and-search-older) model:

- **Confirmed** — a terminal receipt (mutation-confirmed, or rollback-confirmed superseding it) exists for the most recent intent on the most recent candidate/attempt with no ambiguity. Compare its tag against main HEAD: `pass` if aligned, `fail` (drift) if not.
- **Unknown/ambiguous** — the most recent *intent* record (across every candidate/attempt) has no matching terminal receipt (neither mutation-confirmed nor rollback-confirmed). The dimension reports `unknown`, full stop. **It must never fall through to an older candidate's confirmed evidence in this state** — an unresolved "we don't know what's running right now" always outranks a stale "here's what we last confirmed," because the unresolved intent could represent an in-progress or interrupted mutation that has already changed production.
- **No evidence at all** — no intent, no confirmation, nothing, for a given candidate/attempt (e.g. the run failed at registry preflight, before any intent was ever written). This candidate/attempt contributes nothing and search continues to older candidates normally — this is the clean case, unaffected by the ambiguity rule above, since no mutation was ever attempted.

This directly closes the round-23 P2 finding: an interrupted mutation is no longer silently indistinguishable from "this attempt never mutated anything."

## 14. Complete executable regression matrix

Every row below must have a corresponding test once implementation resumes. Existing rounds 12–23 coverage (attempt search, off-main discovery, evidence-timestamp ordering, kill-switch fail-open fixes) carries forward unchanged and is not re-litigated here.

| # | Scenario | Expected result |
|---|---|---|
| 1 | Mutation confirmed, health passes | `confirmed`, tag = new tag, `pass`/`fail` per main-HEAD alignment |
| 2 | Mutation confirmed, health fails, no rollback configured | `confirmed`, tag = new tag |
| 3 | Mutation confirmed, health fails, rollback confirmed | `confirmed`, tag = rollback tag (supersedes) |
| 4 | Mutation confirmed, health fails, rollback **attempted but not confirmed** (rollback fails) | `unknown` — must NOT fall back to the original mutation tag |
| 5 | Failure before mutation intent is ever written (e.g. registry preflight fails) | No evidence for this attempt; search continues to older candidates |
| 6 | Mutation intent written, runner cancelled/disconnected before confirmation write | `unknown` for the whole dimension, regardless of older candidates' confirmed evidence |
| 7 | Mutation confirmed host-side, GitHub artifact upload fails | Named gap (§7) until §12 ships; test asserts the current accepted behavior explicitly, not silently |
| 8 | Rollback confirmed host-side, its own artifact upload fails | Same as #7, rollback-specific |
| 9 | Attempt 1 confirms mutation; attempt 2 is a downstream-only rerun that never re-mutates | Attempt 1's confirmation still wins (rounds 15/22 pattern, generalized) |
| 10 | Off-main/tag dispatch confirms a mutation more recently than the last on-main run | Off-main confirmation wins; compared against main HEAD (round 23 pattern, generalized) |
| 11 | Evidence beyond the 30-day artifact retention window, no newer deploy since | `unreadable` via the artifact channel (§11); not silently trusted |
| 12 | Two candidates both confirmed; an older one's run-level `updated_at` was bumped by an unrelated rerun | Selection uses the confirmation's own timestamp, not run recency (§10, round 16 pattern generalized) |
| 13 | Live host reconciliation disagrees with artifact-derived evidence (once §12 ships) | `unreadable`, explicit disagreement noted in evidence text |

---

## Phasing

This document specifies the target end-state. Implementation may land in ordered slices, but **no slice ships without its own regression-matrix rows passing**, and the ordering itself should be confirmed in review, not assumed:

1. §4/§5/§9 (host-side intent + confirmation, forward and rollback) + §13 (fail-closed unknown) + §8/§10 — the core correctness fix, addressing rounds 22/23's actual findings in full generality rather than patched incrementally.
2. §12 (live host reconciliation) — gated on the explicit PM sign-off named in that section; may ship as a separate, later lane given its distinct secret-exposure surface.
3. §7/§11 named-gap cases remain accepted, tracked debt until §12 ships — not blocking slice 1.

## Non-goals

- No change to `deploy.yml`'s actual deployment mechanics (image resolution, health-check timing, rollback trigger conditions) — this document is about evidence and truth, not deployment behavior.
- No production mutation, activation, or rollback exercised while implementing or verifying this design.
- No weakening of any already-landed UTV2-1660 invariant (parked-contract-receipt attempt-binding, kill-switch fail-closed checks, cross-ref discovery).
