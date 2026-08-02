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
2. **GitHub Actions artifact (transport/cache).** A same-run artifact carrying the same fields, uploaded for cheap querying by `readiness-refresh.ts` without needing SSH access. It is a *copy* of the host-side fact, never the sole source of truth — §12a (intent/confirmation host read) is required for phase 1 precisely so this artifact copy is never the only channel (see §13).

Neither channel is a job/workflow *conclusion*. `probeDeploySha` must never read `run.conclusion`, `run.status`, or any job's conclusion field when deciding whether a mutation occurred — those fields are removed from consideration entirely, not merely deprioritized.

## 2. All refs, including non-main `workflow_dispatch`

`deploy.yml`'s `workflow_dispatch` trigger carries no `branches:` restriction (confirmed: `.github/workflows/deploy.yml`). Evidence discovery (`GithubReader.listRunsByRecency('deploy.yml')`) must never pass a `branch` filter — round 23 already landed this for `probeDeploySha`; this document ratifies it as a standing invariant, not a one-off fix. `resolveParkedContractReceipt`'s equivalent discovery already does this (round 8).

## 3. Workflow runs and rerun attempts

GitHub Actions reruns are per-*attempt*, not per-run: a failed-jobs-only rerun of a downstream job (e.g. `smoke`) advances a run's `run_attempt` without re-executing the mutation step. Evidence must be keyed to `(run_id, run_attempt)` at minimum, and discovery must search every attempt of a candidate run (current down to 1) before moving to an older candidate — this part of rounds 12/14/15/16's design is correct and carries forward unchanged. What changes is *what* is being searched for at each attempt: a host-side/artifact receipt (§1), never a job conclusion. **`(run_id, run_attempt)` alone is not sufficient to uniquely identify a mutation — see §3.5 for why `stage` and `operation_id` must also be part of the key.**

## 3.5. Operation identity across canary and promote (Codex design review, round 1)

**Codex finding (P1):** `deploy.yml` performs *two* independent host mutations under the same workflow run — the **canary** job's `docker compose up -d --no-deps api` (line ~402, api service only) and the **promote** job's `docker compose up -d --remove-orphans` (line ~792, full production). Both typically share the same `run_id`, `run_attempt`, and resolved `IMAGE_TAG`. Keying evidence only by `(run_id, run_attempt)` (as §3 originally specified) cannot distinguish "canary confirmed its api-only mutation" from "promote confirmed the full production mutation" — if canary confirms and promote's own intent is later interrupted before its confirmation is written, a lookup keyed only on `(run_id, run_attempt)` could match canary's older, narrower confirmation as if it were promote's, falsely reporting `confirmed` for a production mutation that never actually completed.

**Fix:** every intent and terminal receipt (mutation-confirmed, rollback-confirmed) carries two additional fields, and matching/selection is keyed on the full tuple `(run_id, run_attempt, stage, operation_id)`, never on `(run_id, run_attempt)` alone:

- `stage`: one of `"canary"`, `"promote"`, `"rollback"` — which job/mutation-point produced this record.
- `operation_id`: a monotonic, unique identifier for this specific mutation attempt (e.g. a UUID generated fresh by the workflow step immediately before intent is written) — distinguishes even two records that would otherwise share every other field (e.g. a job manually re-run with the same run_id/attempt is not possible in GitHub Actions, but this closes the gap defensively rather than relying on that assumption).

**Revised (Codex design review, round 2) — canary is NOT out of scope.** The round-1 text here originally declared canary-stage records irrelevant to `deploy_sha_alignment`, reasoning they were internal to `deploy.yml`'s own canary-gating. That was wrong: canary's mutation (`docker compose up -d --no-deps api`, `deploy.yml:402`) is a **real, partial production mutation** — it replaces the running `api` container specifically — and canary has its own health-check-then-rollback path (`deploy.yml:410`), structurally symmetric to promote's. Two concrete failure scenarios this must handle, both requiring their own regression-matrix rows (§14):

- Canary confirms its `api`-only mutation, then its own health-check fails with **no rollback configured** — production is left genuinely mixed (the `api` service on the new tag; every other service on whatever the last promote left them on). There is no single correct `deployed_sha` to report in this state.
- Canary confirms successfully, canary's health-check passes, but **promote's own registry preflight then fails before promote ever writes an intent** — the same mixed state results, and naively treating "no promote evidence" as the clean "nothing happened" case (§13's third bullet) would search past it to an older, fully-resolved promote confirmation and misreport a stale-but-consistent state as current.

**Selection rule:** for each candidate run/attempt, find the chronologically latest operation across *all three* stages (by intent timestamp). If that latest operation's stage is `"promote"` or `"rollback"`, normal §13 classification applies (a full/final production mutation). If the latest operation's stage is `"canary"` — meaning canary ran and nothing further (no promote intent, confirmed or not) exists for this run at all — the run is in a **mixed, unresolved state** and the whole dimension reports `unknown`, exactly like an unresolved intent (§13). A canary-only run is never silently skipped as "no evidence" and never treated as fully resolved.

This means canary's job in `deploy.yml` needs the identical mutation/confirmation-write/health-check/rollback restructuring already specified for promote (§5) — a same-`set -eu`-block confirmation write immediately after canary's own `docker compose up -d --no-deps api` succeeds, before its health-check loop runs — not only promote. `probeDeploySha`'s evidence-of-interest spans all three stages; none is out of scope.

## 4. Pre-mutation intent

Before any remote mutation command runs, the workflow writes a **pre-mutation intent** record to the host, atomically (temp file + `mv`), containing:

```json
{
  "schema": "deploy-mutation-intent/v1",
  "run_id": "...",
  "run_attempt": "...",
  "stage": "promote",
  "operation_id": "...",
  "requested_tag": "...",
  "source_sha": "...",
  "intent_recorded_at": "..."
}
```

`source_sha` (§8) is the workflow run's own `github.sha` — the commit the build step actually ran from — independent of whatever human-chosen `requested_tag`/`IMAGE_TAG` was used for the image itself.

This captures "a mutation to this tag was about to be attempted" *before* `docker compose up -d` runs, so that a runner cancellation or connectivity loss during or immediately after the mutation attempt leaves a durable trace even if the terminal confirmation (§5) never gets written. The intent record is not itself proof of a completed mutation — see §13 for how the absence of a matching terminal receipt is scored.

## 5. Host-side mutation confirmation

Immediately after `docker compose up -d --remove-orphans` succeeds, in the **same** `ssh ... "set -eu && ..."` command block (not a later step, not a later SSH call), the remote script writes a **mutation-confirmed** record next to the existing `.unit-talk-release` file:

```json
{
  "schema": "deploy-mutation-confirmed/v1",
  "run_id": "...",
  "run_attempt": "...",
  "stage": "promote",
  "operation_id": "...",
  "deployed_tag": "...",
  "source_sha": "...",
  "deployed_digests": { "api": "sha256:...", "worker": "sha256:...", "ingestor": "sha256:...", "discord-bot": "sha256:...", "grading-cron": "sha256:..." },
  "confirmed_at": "..."
}
```

`source_sha` is carried forward from the matching intent record (§8). `deployed_digests` is captured via `docker inspect` immediately after `docker compose up -d` succeeds, in the same shell block, following §5.5's durability protocol — required for §12b's daemon reconciliation (a mutable tag cannot be reliably compared against a live immutable digest; see §12b).

**Codex finding (P2, round 3) — the digest snapshot must cover every application service, not a fixed hardcoded list.** Confirmed against `deploy/production/docker-compose.yml:113`: `grading-cron` is a real, distinct service running the same `api` image (`command: ["node_modules/.bin/tsx", "apps/api/src/grading-cron.ts"]`), recreated by an unscoped `docker compose up -d --remove-orphans` the same as every other service — a digest snapshot that omits it (as the round-1/2 examples above did) would let §12b silently report agreement even if `grading-cron` drifts or is manually replaced with a different digest, since it's simply never checked. **Fix:** the confirmation-writing step derives the expected service list from the deployed Compose/topology definition itself (`docker compose config --services`, or the equivalent already-established `topology-spec.yml`), not a fixed list hardcoded into the workflow step or this document — `grading-cron` (and any future service added to production) is included automatically, never by remembering to update a hardcoded array in two places.

Because this write is inside the same `set -eu` block as the mutation, if the write itself fails the whole SSH command returns non-zero — the runner-side caller must treat *any* non-zero exit from this combined command as "mutation status unknown," never as "mutation definitely did not happen" (the containers may have already been replaced before the write failed) and never as "mutation definitely happened" (the write failing could also mean the mutation itself never got that far). This is intentionally the same fail-closed posture as §13.

## 5.5. Durable journal protocol (Codex design review, round 1)

**Codex finding (P2):** "same `set -eu` block" is an *ordering* guarantee, not a *crash-durability* guarantee. A host crash (power loss, OOM-kill, kernel panic) can occur after Docker Compose has committed the container replacement but before the confirmation write reaches stable storage — this is a distinct failure mode from runner-side cancellation (§6), and temp-file-plus-`mv` alone provides atomic *visibility* (a reader never sees a half-written file) but not durability (the write can still be lost entirely on crash) unless the file and its containing directory are explicitly synced to disk. A confirmation write that isn't temp-file-based at all (a direct write to the final path) can additionally expose a truncated/partial JSON body to a concurrent reader (e.g. §12a) mid-write.

**Fix — every intent and confirmation write (forward mutation and rollback) follows this exact sequence, remotely, inside the same shell block as the mutation it records:**

1. Write the full JSON body to a temp file in the same directory as the final path (`.unit-talk-deploy-intent.tmp`, etc.).
2. `fsync` the temp file's file descriptor.
3. Validate the temp file parses as well-formed JSON matching the expected schema (a cheap `python3 -c "import json; json.load(open(...))"` or equivalent) before proceeding — catches a truncated write immediately rather than persisting a corrupt record.
4. `mv` (rename, same filesystem — atomic) the temp file onto the final path.
5. `fsync` the containing directory's file descriptor (renames are not guaranteed durable until the directory entry itself is synced).

A reader (§12a) that encounters a record failing JSON-schema validation (steps 3's check having been skipped or having failed on a prior crash mid-sequence) must classify it as **malformed → unknown**, per §13 — never attempt best-effort partial parsing, never treat a malformed confirmation as absence-of-confirmation (which would incorrectly fall through to an older candidate).

## 6. Runner cancellation or connectivity loss after mutation

Covered by §4 + §5 together: if the runner is cancelled or loses connectivity *after* the SSH mutation command returns to it, the host-side confirmation (§5) already landed (SSH already completed server-side, durably per §5.5) and is independently readable via §12a. If the runner is cancelled *before* the SSH command completes at all, only the intent record (§4) exists, and §13's fail-closed rule applies. A third, distinct case — a **host crash between the mutation committing and the confirmation write reaching durable storage** (§5.5) — is not a runner-side event at all; it is covered by §5.5's fsync/validate protocol and the malformed/absent-record handling in §13, not by this section's runner-cancellation framing. There is no scenario in this design where a genuine mutation is invisible to every evidence channel simultaneously — that gap is exactly what §4+§5+§5.5 exist to close, replacing the current single-channel ("GitHub artifact only") design that has it.

## 7. Artifact upload failure

If the host-side confirmation (§5) succeeded but the *subsequent* GitHub Actions artifact upload fails (network blip, Actions service issue), the host-side record is still authoritative and still readable via §12a (intent/confirmation host read, required for phase 1 per §13's finding). This sub-case is fully closed once §12a ships — it is not deferred, since §12a is a phase-1 requirement, not phase 2. Only §12b's broader guarantee (verifying against the actual Docker daemon state, not just the receipt files) remains phase-2 scoped; §7 itself does not need §12b.

## 8. Explicit image tags

The evidence record's `deployed_tag`/`requested_tag` field is read directly from the record, never re-derived from `run.head_sha`. This matters because `IMAGE_TAG: ${{ inputs.image_tag || github.sha }}` means a manual dispatch with an explicit `image_tag` input can differ from the run's own commit SHA — trusting `head_sha` blindly (the pre-round-22 design) would misreport the deployed tag for any such dispatch. `probeDeploySha`'s `deployed_sha`/alignment comparison uses the record's own tag field, matching the round-22 mutation-receipt design already landed.

**Codex finding (P1, round 3) — `deployed_tag` alone produces false drift against main HEAD.** Confirmed against the real build step (`deploy.yml:181-187`): every image is published under **both** `${{ inputs.image_tag || github.sha }}` **and** `${{ github.sha }}` explicitly, with `UNIT_TALK_GIT_SHA=${{ github.sha }}` baked in as a build-arg. So a manual dispatch with e.g. `image_tag: release-2026-08-02` deploys an image that genuinely *is* main HEAD, but `deployed_tag` records the literal string `"release-2026-08-02"` — comparing that against `mainSha` (a 40-char commit SHA) would report a false drift/failure even though the deployed commit is exactly correct. `deployed_tag` is deployment/rollback *identity* (what to target for a future rollback); it is not commit provenance, and must never be compared against main HEAD directly.

**Fix:** every promote/canary intent and confirmation record additionally carries a `source_sha` field, populated from the workflow run's own `github.sha` context (always available regardless of what `image_tag` was manually supplied — it identifies the commit the build step actually ran from, independent of the human-chosen tag). `probeDeploySha`'s alignment comparison uses `source_sha` against `mainSha`; `deployed_tag` is retained separately for display/identity and for `commitsBetween`-style distance reporting when `source_sha` itself is unavailable.

**Rollback tags need the same provenance, and it is not always resolvable.** `rollback.sh --tag <TAG>` accepts an arbitrary string with no format constraint — in the common case this is a real historical commit SHA (matching the pattern already used in `rollback-dry-run`'s own default, `inputs.rollback_tag || github.sha`), but nothing prevents an operator from supplying an opaque label instead. The rollback-confirmed record should record `rolled_back_to_source_sha` **only when resolvable** — either because the supplied rollback tag is itself a well-formed 40-character commit SHA, or because it matches a `deployed_tag` from an earlier confirmation record whose own `source_sha` is already known. When neither resolution succeeds, `rolled_back_to_source_sha` is absent and the alignment comparison for that state is `unreadable`/`unknown` rather than guessing — this is a genuine, named limitation of rollback-tag provenance, not silently assumed away.

## 9. Successful, failed, and absent rollback

`deploy/rollback.sh`'s remote command has the *identical* mutate-then-confirm shape as the forward path (`cp .unit-talk-release .unit-talk-release.failed` → write new tag → `docker compose pull` → `docker compose up -d`, all under `set -eu`). Rollback therefore needs the same two-phase evidence as the forward mutation, symmetric to §4/§5 — both records carry `stage: "rollback"` and their own fresh `operation_id` (§3.5), and both follow the durable-journal protocol (§5.5):

- **Rollback intent**, written before `rollback.sh`'s remote command runs.
- **Rollback-confirmed** record, written inside `rollback.sh`'s own `set -eu` block immediately after its `docker compose up -d` succeeds.

Three cases, all requiring explicit test coverage (§14):

| Case | Evidence state | Authoritative tag |
|---|---|---|
| Rollback **succeeds** | rollback-intent + rollback-confirmed both present, confirmed timestamp later than the original mutation-confirmed | `rolled_back_to_tag` — supersedes the original mutation. `rolled_back_to_source_sha` is also recorded when resolvable (§8) — either the rollback tag is itself a well-formed commit SHA, or it matches an earlier confirmation's `deployed_tag` whose `source_sha` is already known; otherwise alignment for this state is `unreadable`/`unknown`, not guessed |
| Rollback **fails** (script exits non-zero, e.g. `docker compose pull` fails on the rollback tag) | rollback-intent present, rollback-confirmed absent | Whole dimension → `unknown` per §13 (a rollback was attempted; host state cannot be assumed) — **not** silently falling back to the original mutation-confirmed record |
| Rollback **absent** (no `rollback_tag` input supplied, health-check simply exits 1 with no rollback attempted) | no rollback-intent at all | Original mutation-confirmed record stands unchallenged |

The "rollback fails → unknown, not fallback" rule is the single most important correctness property in this document: it is the direct fix for treating "we don't know" as if it were "the old answer is still true," the exact failure mode this whole design exists to close.

## 10. Evidence ordering and timestamps

All cross-run/cross-attempt comparisons order by the evidence record's own `confirmed_at` (or `rolled_back_at`) timestamp — never by run-level `updated_at`, never by job `completed_at`, never by artifact `created_at`. This generalizes round 16's fix (compare by the promote job's own completion time) to the new evidence shape. Timestamp comparisons use parsed epoch values (the existing `isAfter()` helper), never lexical string comparison (round 9's fix, unchanged).

## 11. Artifact retention and expiry

GitHub artifacts expire (`retention-days: 30`, matching the existing `parked-contract-receipt`/`deploy-mutation-receipt` pattern). A deployment older than the retention window with no newer deploy since becomes unreadable via the artifact channel alone — this is the original round-1 P2, formally named here rather than re-discovered. §12a's host read provides a retention-independent fallback (the host's own confirmation files don't expire) and is required for phase 1, so this gap is fully closed once §12a ships, not merely mitigated. §12b (full daemon-state reconciliation) is not needed to close this specific gap.

## 12. Live host reconciliation

**This is a new capability, not present in any prior round, and requires explicit PM sign-off before implementation** because it means granting `readiness-refresh.ts`'s execution context read-only SSH access to the production deploy host — a real, new secret-exposure surface distinct from its current Supabase/`gh` credentials.

Split into two sub-capabilities of different scope, urgency, and phasing (Codex design review, round 1 — see §12a/§12b below for why splitting was necessary, not optional).

### 12a. Intent/confirmation host read (required for phase 1 — see Phasing)

A narrow, read-only capability whose *only* job is answering "does an unresolved intent record exist on the host with no matching terminal receipt?" — reading back the small `deploy-mutation-intent`/`deploy-mutation-confirmed`/`deploy-rollback-confirmed` JSON files directly (§4/§5/§9), the same read `deploy.yml`'s own "Confirm syndicate machine gate" step already performs at deploy-time, reused as a readiness-side capability.

**Codex finding (P1) — why this can't be deferred to phase 2:** before any host-read capability exists, "no artifact found" is ambiguous between "no intent was ever written" (clean case, §13's third bullet) and "an intent was written host-side but the runner was cancelled before it could be uploaded as a GitHub artifact at all" (ambiguous case, §13's second bullet) — both look identical from the artifact channel alone. Making intent's own *visibility* depend on the same GitHub Actions artifact-upload mechanism whose fragility is the entire reason intent records exist is circular. §12a resolves this: intent records are read directly from the host, never solely via a GitHub artifact upload, so their existence is never contingent on the failure mode they exist to detect.

**Codex finding (P1) — SSH boundary must be enforced, not merely typed:** a `HostReader` TypeScript interface does not make the underlying SSH credential read-only. Unless the *host* enforces the restriction, any code running in the scheduled workflow can use the key for arbitrary shell commands, file reads, port forwarding, or mutation — a `readHostReleaseState()` method name is a promise, not a boundary. Required host-side hardening, for both §12a and §12b:

- A **separate, unprivileged** SSH account/key, distinct from the deploy-time `UNIT_TALK_DEPLOY_SSH_KEY`.
- An `authorized_keys` **forced command** binding that key to a single, fixed, root-owned reader script — the key can never be used to run arbitrary commands, regardless of what the calling workflow requests.
- **PTY, agent forwarding, and port forwarding all disabled** on that key.
- The forced-command reader returns only the sanitized release-state payload (the JSON files' contents, or a fixed error), never a general shell.

This hardening is a prerequisite for §12a shipping at all, not a nice-to-have layered on afterward.

### 12b. Live container/daemon reconciliation (phase 2 — see Phasing)

**Codex finding (P1):** §12a alone (re-reading `.unit-talk-release` and the confirmation JSON files) only cross-checks two records *produced by the deployment workflow itself* — it does not establish independent ground truth about what is actually running. An operator's manual intervention, a recovery script, or a later out-of-band `docker compose` operation can change the running containers without updating either file, leaving the artifact and the host's own receipt files in perfect agreement with each other while production actually runs a different (or a mixed) set of images. This is invisible to §12a by construction, since both "sources" it compares are the same claim written by the same process.

§12b closes this: the restricted host reader (same hardened SSH boundary as §12a) additionally inspects the **actual running Compose project's services and their immutable image IDs/digests** (`docker inspect` / `docker compose ps --format json`, not `.unit-talk-release`) and compares that against a durable expected-digest snapshot.

**Codex finding (P2) — comparing against `deployed_tag` alone is unreliable:** the confirmation record (§5) as originally specified only captures `deployed_tag`, a *mutable* registry reference — a tag can be repointed at a different digest after confirmation, so comparing a live, immutable digest against a mutable tag either compares unlike values or requires re-resolving the tag at check-time, which can itself return a different answer than what was true at the moment of confirmation. **Fix:** the confirmation record (§5, and the equivalent rollback-confirmed record, §9) must additionally capture the resolved immutable image ID/digest for *every* expected Compose service at confirmation time (a `docker inspect` immediately after `docker compose up -d` succeeds, in the same shell block, same durability protocol as §5.5), e.g. `"deployed_digests": {"api": "sha256:...", "worker": "sha256:...", "ingestor": "sha256:...", "discord-bot": "sha256:..."}`. §12b compares the live daemon's per-service digests against this persisted snapshot directly — never against a re-resolved tag. Disagreement is `unreadable`, with the specific mismatch named in evidence text (e.g. "confirmed digest for `api` was sha256:aaa; container is actually running sha256:bbb").

Used to:

- Cross-verify the GitHub-artifact-derived answer against §12a and §12b ground truth, flagging disagreement as `unreadable` rather than silently trusting any single side.
- Serve as a fallback evidence path when the artifact channel is unavailable (§7, §11).

**Open decision for PM:** whether readiness-refresh's execution environment (a scheduled/dispatched GitHub Actions job) is an acceptable place to hold the §12a/§12b read-only deploy-host SSH credential (even fully hardened per the forced-command boundary above), or whether this capability should instead live in a separate, more tightly-scoped job/service. Flagging this explicitly rather than deciding it implicitly during implementation is itself an application of the operating-model change requested — architectural questions get decided before code, not discovered as a review finding.

## 13. Fail-closed UNKNOWN versus confirmed drift/failure

Three-way classification, replacing the current two-way (trust-this-candidate / reject-and-search-older) model. **This classification requires §12a (intent/confirmation host read) to be implemented and available — see the finding below for why the "no evidence at all" case is unsound without it.**

**Codex finding (P1, round 2) — "available" must mean a successful read on THIS evaluation, not merely "implemented":** §12a can be fully implemented and still fail at runtime — SSH timeout, authentication failure, host unreachable, or the forced-command reader returning its own fixed error. In any of these cases, an artifact-only confirmation cannot prove that a newer, host-only, unresolved intent doesn't exist right now — accepting the artifact anyway (or falling through to an older candidate) silently recreates the exact no-evidence-inference gap this whole revision exists to close, just moved from "§12a doesn't exist" to "§12a's read didn't succeed this time." **Fix:** every unsuccessful §12a read attempt — for whatever reason, transient or not — makes the *whole dimension* `unknown`/unreadable for this evaluation. There is no fallback to artifact-only evidence when the host read fails; a failed §12a read is scored identically to §12a not existing at all.

- **Confirmed** — a terminal receipt (mutation-confirmed, or rollback-confirmed superseding it, matched on the full `(run_id, run_attempt, stage, operation_id)` tuple per §3.5) exists for the most recent intent on the most recent candidate/attempt with no ambiguity, and is well-formed per §5.5's validation. Compare its `source_sha` (§8) against main HEAD, never `deployed_tag` directly: `pass` if aligned, `fail` (drift) if not. If `source_sha` itself is unresolvable (the rollback-tag provenance gap named in §8), the result is `unreadable`/`unknown`, not a guess.
- **Unknown/ambiguous** — the most recent *intent* record (across every candidate/attempt, read via §12a) has no matching terminal receipt (neither mutation-confirmed nor rollback-confirmed for that same `(run_id, run_attempt, stage, operation_id)`), OR a record that should be a terminal receipt fails §5.5's malformed-record check. The dimension reports `unknown`, full stop. **It must never fall through to an older candidate's confirmed evidence in this state** — an unresolved "we don't know what's running right now" always outranks a stale "here's what we last confirmed," because the unresolved intent could represent an in-progress or interrupted mutation that has already changed production.
- **No evidence at all** — §12a's host read confirms no intent record exists for this candidate/attempt/stage at all (e.g. the run failed at registry preflight, before any intent was ever written). This candidate/attempt contributes nothing and search continues to older candidates normally — this is the clean case, unaffected by the ambiguity rule above, since no mutation was ever attempted.

**Codex finding (P1) — why "no evidence" cannot be inferred from a missing GitHub artifact alone:** before §12a exists, "no artifact found" cannot distinguish "the run failed before intent was ever written" (the clean third case above) from "an intent exists only on the host because the runner was cancelled before an artifact upload could even happen" (the second, ambiguous case) — both present identically as "nothing found" via the artifact channel, and the same ambiguity applies to artifact expiry (§11) and transient GitHub API failures. Scoring the clean case from artifact-absence alone would let this dimension search an older candidate's confirmation and report stale production truth as current — silently reintroducing exactly the failure this whole document exists to close. **The "no evidence at all" branch is therefore only ever reached via a successful §12a host read that positively confirms no intent record exists** — never inferred from artifact absence. This is why §12a moved from "phase 2, nice to have" to "required for phase 1" (see Phasing).

This directly closes the round-23 P2 finding: an interrupted mutation is no longer silently indistinguishable from "this attempt never mutated anything."

## 14. Complete executable regression matrix

Every row below must have a corresponding test once implementation resumes. Existing rounds 12–23 coverage (attempt search, off-main discovery, evidence-timestamp ordering, kill-switch fail-open fixes) carries forward unchanged and is not re-litigated here.

| # | Scenario | Expected result |
|---|---|---|
| 1 | Mutation confirmed, health passes | `confirmed`, tag = new tag, `pass`/`fail` per main-HEAD alignment |
| 2 | Mutation confirmed, health fails, no rollback configured | `confirmed`, tag = new tag |
| 3 | Mutation confirmed, health fails, rollback confirmed | `confirmed`, tag = rollback tag (supersedes) |
| 4 | Mutation confirmed, health fails, rollback **attempted but not confirmed** (rollback fails) | `unknown` — must NOT fall back to the original mutation tag |
| 5 | Failure before mutation intent is ever written (e.g. registry preflight fails), confirmed via §12a host read | No evidence for this attempt; search continues to older candidates |
| 6 | Mutation intent written, runner cancelled/disconnected before confirmation write | `unknown` for the whole dimension, regardless of older candidates' confirmed evidence |
| 7 | Mutation confirmed host-side, GitHub artifact upload fails, §12a available | `confirmed` via §12a's host read; artifact loss alone no longer degrades the result |
| 8 | Rollback confirmed host-side, its own artifact upload fails, §12a available | Same as #7, rollback-specific |
| 9 | Attempt 1 confirms mutation; attempt 2 is a downstream-only rerun that never re-mutates | Attempt 1's confirmation still wins (rounds 15/22 pattern, generalized) |
| 10 | Off-main/tag dispatch confirms a mutation more recently than the last on-main run | Off-main confirmation wins; compared against main HEAD (round 23 pattern, generalized) |
| 11 | Evidence beyond the 30-day artifact retention window, no newer deploy since, §12a available | `confirmed`/`unknown` per §12a's host read, not silently `unreadable` from artifact expiry alone |
| 12 | Two candidates both confirmed; an older one's run-level `updated_at` was bumped by an unrelated rerun | Selection uses the confirmation's own timestamp, not run recency (§10, round 16 pattern generalized) |
| 13 | Canary confirms its api-only mutation; promote's own intent is written but interrupted before promote's confirmation | `unknown` for the whole dimension (promote's unresolved intent) — canary's confirmation must NOT be matched as if it were promote's (§3.5) |
| 14 | Confirmation write interrupted mid-sequence by a host crash (power loss / OOM-kill) between Docker committing and the write reaching durable storage (§5.5) | Reader finds either no record (crash before temp-write) or a malformed/truncated record (crash mid-write, caught by §5.5's validation) — both classify as `unknown`, never as `confirmed` |
| 15 | §12a/§12b's SSH credential is used to attempt an arbitrary command (not the forced reader) | Host rejects it — the forced-command/no-PTY/no-forwarding boundary (§12a) prevents this regardless of what the calling code requests |
| 16 | (Phase 2, needs §12b) An operator manually replaces a running container out-of-band; `.unit-talk-release` and the confirmation JSON are never updated | §12a alone reports `confirmed` (files agree with each other) — **known phase-1 limitation**, only closed once §12b's daemon-state inspection ships; test asserts this is the documented, accepted phase-1 behavior, not silently wrong |
| 17 | (Phase 2, needs §12b) §12b's live daemon inspection disagrees with the artifact/§12a-derived evidence | `unreadable`, explicit mismatch between the persisted per-service digest snapshot and the live daemon's digests noted in evidence text (§12b) |
| 18 | Canary confirms its api-only mutation; canary's own health-check fails with no rollback configured | `unknown` for the whole dimension — a confirmed canary with no subsequent promote (intent or confirmation) is a mixed, unresolved state (§3.5), never silently resolved to an older promote's tag |
| 19 | Canary confirms and its health-check passes; promote's registry preflight then fails before promote ever writes an intent | `unknown` for the whole dimension — same mixed-state rule as row 18, this time promote never even attempted rather than attempted-and-interrupted |
| 20 | Canary's own intent is written but canary is interrupted before its own confirmation (runner cancelled, or host crash per §5.5) | `unknown` for the whole dimension — canary-stage intent is subject to the identical unresolved-intent rule as promote/rollback intent (§13), not exempted as "internal to deploy.yml" |
| 21 | §12a's host read fails at evaluation time (SSH timeout, auth failure, host unreachable, forced-command error) while an otherwise-valid, well-formed artifact confirmation exists for the same run | `unknown`/unreadable for the whole dimension — a failed §12a read is scored identically to §12a not existing at all; the valid-looking artifact is never trusted on its own in this state (§13) |
| 22 | Manual `workflow_dispatch` with `image_tag: release-2026-08-02` deploys a build whose commit genuinely matches main HEAD | `pass` — comparison uses `source_sha` (§8), not the literal `deployed_tag` string, so a human-readable tag never produces a false drift report |
| 23 | `docker compose up -d --remove-orphans` recreates `grading-cron` (same `api` image, per `deploy/production/docker-compose.yml`) at a different digest than expected, while `api`/`worker`/`ingestor`/`discord-bot` all match | (Phase 2, needs §12b) `unreadable` — the expected-service list is derived from the deployed Compose/topology definition, so `grading-cron` is never silently absent from the comparison (§5) |

---

## Phasing

This document specifies the target end-state. Implementation may land in ordered slices, but **no slice ships without its own regression-matrix rows passing**, and the ordering itself should be confirmed in review, not assumed. **Codex's design review (round 1) found that the original two-phase split here was unsound** — deferring all host access to "phase 2" left phase 1's own §13 classification unable to distinguish "no mutation attempted" from "mutation attempted, evidence lost," which is exactly the ambiguity this document exists to close. Revised:

1. **Phase 1 (required together, not separable):** §3.5 (operation identity/stage, including canary's in-scope status) + §4/§5/§9 (host-side intent + confirmation, forward and rollback) + §5.5 (durable journal protocol) + §8 (`source_sha` provenance, separate from `deployed_tag`) + §12a (intent/confirmation host read, with its forced-command/no-PTY SSH hardening, and fail-closed behavior on read failure) + §13 (fail-closed three-way classification) + §10. §12a is part of the *core correctness fix*, not an optional enhancement to it — regression matrix rows 5–8, 11, 13–15, 18–22 all depend on it or §8's provenance fix existing. This is the direct consequence of Codex's finding that §13's "no evidence" branch is unsound without a host-read capability, generalized across rounds 1–2 to cover canary's own unresolved-intent case and §12a's runtime failure modes, and round 3's finding that tag identity and commit provenance are not interchangeable.
2. **Phase 2:** §12b (live container/daemon reconciliation against actual running state, not just receipt files, including the full deployed-service digest snapshot) — a strictly larger capability than §12a (broader host inspection, not just reading two small JSON files), may ship as a separate, later lane. Regression matrix rows 16–17 and 23 are phase-2-only and must not be silently claimed as covered by a phase-1 implementation.
3. The PM sign-off named in §12 (whether readiness-refresh's execution context is an acceptable place to hold the hardened SSH credential at all) gates **both** 12a and 12b, since they share the same credential and host-side hardening — this decision cannot be deferred past phase 1 the way §12b's broader scope can.

## Non-goals

- No change to `deploy.yml`'s actual deployment mechanics (image resolution, health-check timing, rollback trigger conditions) — this document is about evidence and truth, not deployment behavior.
- No production mutation, activation, or rollback exercised while implementing or verifying this design.
- No weakening of any already-landed UTV2-1660 invariant (parked-contract-receipt attempt-binding, kill-switch fail-closed checks, cross-ref discovery).
