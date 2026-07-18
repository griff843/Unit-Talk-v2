# T1-M / T1-H Delegation — Codex Adversarial Repository Review

**Status:** Independent adversarial review — no implementation authorized  
**Reviewer:** Codex  
**Date:** 2026-07-17  
**Design reviewed:** `docs/06_status/T1M_DELEGATION_DESIGN_PACKET.md`

---

**PM disposition note (2026-07-18, added by orchestrator per PM instruction — Codex's findings below are
unaltered; corrected 2026-07-18 per PM changes-required review of PR #1252).** All P0 and P1 findings in this
review are accepted as mandatory and are incorporated into `T1M_DELEGATION_DESIGN_PACKET.md` Revision 2
(§"Revision 2 — Codex reconciliation") and further synthesized in
`docs/06_status/T1M_DELEGATION_FINAL_PM_DECISION.md`, the binding decision document for this redesign. The
repair bounce cap — this review's §"Repair bounces" recommends 2; the Design Packet's original (superseded)
Revision 1 draft proposed 3 — is settled in the Final PM Decision §11: **the cap is 2**, exactly matching this
review's recommendation. There is no remaining disagreement between this review and the Design Packet on this
point; an earlier drafting pass incorrectly recorded a widened cap of 3 as a deliberate PM divergence from this
review, which was a drafting error, not an intended policy choice. This review's tighter zero-bounce immediate
escalation for classification disputes, authority vetoes, injection findings, identity anomalies, and ledger
anomalies is preserved in full and was never in question. No other finding in this document was overridden.

---

## 1. Verdict

**REVISE**

The design has the right security objective, but it is not implementable safely as written and cannot reuse the current merge-authorization trust model.

The core blockers are:

- Current T1 approval is mutable, text-parsed, not exact-head-bound, and issued through the same `griff843` identity used by implementers and orchestrators.
- The mechanical tier classifier is advisory-only and only derives a T1 floor. It cannot mechanically prove the stronger T1-M conditions.
- All current required checks are issued by the same GitHub Actions App ID (`15368`), so workflow-name or check-name validation does not establish independent identity.
- Production and canary environments have no protection rules. Admin bypass is enabled, including on `main`.
- The repository has no immutable acceptance-criteria snapshot.
- The proposed workflows would be self-modifying unless privileged logic always executes from trusted `main`, never from PR code.
- The current GitHub configuration cannot prove that distinct models performed the reviews. Separate GitHub Apps can prove distinct service principals, but model identity still requires a trusted external reviewer service and signed attestation.

The packet should proceed only after the P0 controls below are designed, bootstrapped under Griff’s existing authority, and validated in shadow mode.

## 2. P0–P3 findings

### P0 — Current approval can be forged or replayed

`.github/workflows/merge-gate.yml` accepts `pm-verdict/v1` comments that contain only verdict, schema, and issue ID. It does not bind approval to:

- PR number
- head SHA
- base repository
- base branch
- current `main`
- acceptance-criteria hash
- diff/tree hash
- an approval round
- a unique nonce

A valid old approval therefore survives new commits. A copied verdict can also authorize another PR carrying the same issue ID.

The `t1-approved` label is similarly mutable and unbound. Anyone able to act as `griff843` or administer the repository can apply it.

**Required resolution:** eliminate comment and label artifacts from the T1-M authorization decision. Keep labels only as human-readable evidence.

### P0 — Current identities are not distinct

Repository evidence shows:

- PR authorship and PM authorization both resolve to `griff843`.
- `CODEOWNERS` contains only `@griff843`.
- Every currently required check is associated with GitHub Actions App ID `15368`.
- Default `GITHUB_TOKEN` cannot submit approving PR reviews, but it can create check runs where a workflow grants `checks: write`.

Consequently, distinct authenticated reviewers do not exist today.

They are technically achievable only by creating separately installed GitHub Apps with separate private keys and external reviewer services. Four workflows using four secret names are not four identities if they all create checks through `GITHUB_TOKEN`.

Even with separate Apps, GitHub proves only “App X issued this check.” It cannot prove “Grok/Fable/Codex inspected this diff.” That requires a trusted reviewer backend to attest its model/provider/request identity.

### P0 — Privileged workflow self-modification

If a reviewer workflow checks out and executes scripts from the PR head while holding a reviewer App key, the implementer can modify the script and mint approval.

No privileged T1-M workflow may:

- execute PR-controlled code;
- load actions or composite actions from the PR;
- use a PR-controlled prompt template;
- parse a PR-controlled schema;
- load the allowlist, charter, or reviewer roster from the PR head.

All authorization code and policy must be loaded from trusted current `main` or an immutable release SHA. The PR diff must be treated strictly as input data.

### P0 — T1-M cannot presently be derived mechanically

`scripts/ops/tier-classifier.ts` can answer only:

> Does a changed path match the existing Tier C sensitivity list?

It cannot establish:

- reversibility by `git revert` alone;
- absence of externally consequential behavior;
- absence of new network egress;
- absence of credential use;
- absence of activation semantics;
- that acceptance tests existed before implementation;
- that an existing allowlisted file has not become authority-sensitive;
- semantic mutations hidden inside otherwise eligible paths.

Therefore the proposed conjunctive T1-M classifier is mechanically achievable only as a conservative eligibility proof. Anything not affirmatively proven must be T1-H.

“Pure domain code” should not be in the pilot allowlist. Under current policy, `packages/domain/src/**` is Tier C, and changes can alter financial, grading, promotion, or user-visible behavior.

### P0 — Merge and deployment authority are not separated

`.github/workflows/deploy.yml` is manually dispatchable, but the live GitHub environments have:

- no required reviewers;
- no branch/tag deployment restrictions;
- `can_admins_bypass: true`.

Main branch protection also has `enforce_admins: false`.

A compromised or over-privileged repository actor could merge and then deploy. Before live delegation:

- production must require Griff as environment reviewer;
- canary must have an explicit approved deployment policy;
- admin bypass must be disabled where GitHub permits it;
- reviewer Apps must have no Actions dispatch, environment, deployment, package-write, or secrets-management permission;
- deployment must accept only a commit reachable from protected `main`.

### P0 — Bootstrap circularity

The first PR adding machine authorization modifies:

- Merge Gate
- classifier authority
- reviewer identity rules
- delegation policy
- kill-switch semantics
- privileged workflow topology

It is necessarily T1-H. The new quorum cannot approve the PR that creates or enables the quorum. Nor can a partially installed quorum approve later bootstrap pieces unless the old Griff-only gate remains authoritative throughout bootstrap.

### P1 — Exact-current-main binding is underspecified

Binding to PR head alone is insufficient. The authorization unit must include:

- repository ID
- PR number
- issue ID
- head SHA
- base branch
- base SHA at review
- merge-base SHA
- current protected-main SHA
- diff/tree digest
- criteria snapshot digest
- classifier-policy revision
- charter revision
- reviewer-roster revision
- authorization round

Because branch protection is strict, a main advance makes the branch non-current. The quorum gate must independently compare these values immediately before merge. After main advances, all approvals must become stale.

The existing merge train updates branches and reposts executor results. T1-M must force a complete new classification and review round after every update, not merely repost prior artifacts.

### P1 — The nonce proposal is unnecessary but incomplete

SHA-only is insufficient because the same commit can appear on multiple PRs or be retargeted.

A random nonce adds little if the authorization record already includes the complete immutable context. Prefer a deterministic round ID:

```text
round_id = SHA256(
  repository_id ||
  pr_number ||
  issue_id ||
  head_sha ||
  base_ref ||
  base_sha ||
  merge_base_sha ||
  criteria_sha256 ||
  policy_revision ||
  roster_revision ||
  charter_revision
)
```

This prevents cross-PR and cross-round replay without introducing a nonce issuer that becomes another authority.

### P1 — Issue and criteria binding is not currently possible

The lane manifest explicitly says acceptance criteria live in Linear and are not manifest authority. Current manifest schemas contain no frozen criteria body or hash.

A simple hash in the manifest would still be weak because:

- lane-start runs under orchestrator control;
- the orchestrator can choose when to snapshot;
- manifest repair paths can alter committed metadata;
- Linear can be edited after snapshot;
- there is no trusted “criteria approved before implementation” event.

**Required solution:** create an immutable criteria snapshot as a GitHub artifact/check issued by a trusted intake App before lane execution. It must include normalized criteria text, Linear issue UUID/version, snapshot time, and digest. The reviewer receives both the snapshot and digest. Editing Linear later must invalidate or supersede the lane, never silently refresh the snapshot.

### P1 — Review of the actual diff cannot be guaranteed by prompt wording

No system can guarantee that an LLM semantically understood a diff. It can guarantee that the reviewer was given the exact diff and require evidence of processing.

Each reviewer backend must independently fetch from GitHub:

- PR metadata;
- base and head SHAs;
- every changed file;
- patch hunks or full blobs where patches are truncated;
- rename and binary-file metadata;
- submodule changes;
- the frozen criteria artifact.

It must reject summaries as review inputs and emit:

- digest of the complete diff/input bundle;
- list of files inspected;
- per-file coverage result;
- explicit acknowledgment of binary, generated, renamed, or truncated files;
- findings tied to path and line/hunk;
- a self-generated change summary;
- provider request ID and model version.

Approval is invalid if `files_inspected` differs from GitHub’s changed-file set.

### P1 — Kill switch is checked at only one proposed boundary

The existing `governance:pause` is a per-PR label, not a global delegation switch. It is also mutable and checked only by Merge Gate.

The new switch must fail closed at:

1. Dispatch: refuse creation/resume of T1-M lanes.
2. Review dispatch: do not issue a new review round.
3. Reviewer execution: check before model call and before publishing the verdict.
4. Certification: refuse to aggregate verdicts.
5. Merge readiness and merge wrapper: check immediately before requesting merge.
6. GitHub Merge Gate: check from trusted external state at evaluation time.
7. Execution/deployment: T1-M must not confer deployment permission; production checks delegation state only to prevent accidental machine activation, not to authorize deployment.
8. Repair/resume/reconcile paths: never revive a frozen lane while disabled.

A checked-in charter is useful for expiry but cannot provide an instant kill. The repository Actions variable can be instant, but an administrator or workflow with variables-write permission could flip it. Treat Griff’s administration boundary as the root of trust.

### P1 — Check-run identity must use App ID and installation ID

Check names and workflow names are spoofable. `GITHUB_TOKEN` check runs all appear under the GitHub Actions App, regardless of workflow.

Validate:

- check-run App numeric ID;
- App slug;
- installation/repository relationship where available;
- external ID or signed payload digest;
- exact head SHA;
- unique seat;
- round ID;
- conclusion plus structured output digest.

Do not accept a check merely because its name is `UTV2 T1M Tech Review`.

### P1 — Ledger is not append-only if stored only in check output

Check runs can be rerequested, replaced, or deleted by sufficiently privileged actors. A “latest check wins” query enables shopping.

Use an external append-only audit store or GitHub artifact plus repository-independent transparency log. Each event should hash-chain to its predecessor:

```text
event_hash = SHA256(previous_event_hash || canonical_event)
```

The merge gate must reject:

- multiple approvals for one seat/round;
- an approval following a reject on the same round;
- missing prior rejection history;
- gaps in the hash chain;
- a round whose bounce number conflicts with the ledger.

### P1 — Reviewer shopping remains possible through new heads

An implementer can make semantically irrelevant commits after a rejection to obtain a new sampling round. A fixed bounce count helps but does not prevent shopping.

Required rule:

- classification dispute, authority veto, injection finding, or identity anomaly: immediate T1-H escalation, no bounce;
- ordinary correctness rejection: maximum two repair rounds after the initial review;
- each new round must include the complete prior objection ledger;
- reviewer seat and provider configuration are fixed for the lane;
- no reruns after a completed verdict;
- infrastructure retry may occur once only before a verdict exists, with the same provider/model configuration.

### P2 — Existing authority path lists are incomplete and semantically mismatched

`scripts/ops/merge-risk.ts` is reusable as one source of sensitive paths, but its purpose is conflict/tier-floor detection. It is not sufficient as the T1-M eligibility allowlist.

Examples:

- `scripts/ci/**` defaults to no floor even though it may implement required checks.
- `package.json`, lockfiles, build configuration, GitHub config, action code, deploy scripts, Docker and infrastructure files require explicit handling.
- New sensitive paths will default to eligible unless classification uses deny-by-default.
- Tests under sensitive paths can disable or weaken proof even if they do not change runtime.

T1-M should begin from a tiny explicit file-kind allowlist, then subtract a broad denylist. Unknown paths are T1-H.

### P2 — Current repository protection has bypasses

Live GitHub configuration showed:

- `enforce_admins: false`
- required conversation resolution off
- Actions allowed from all sources
- action SHA pinning off
- unsigned commits allowed
- only four required contexts
- all required contexts issued by one App ID

These do not all have to block the pilot, but live delegation requires admin enforcement, pinned third-party actions for privileged workflows, and strict required-check App binding where supported.

### P2 — Merge mutex is local operational serialization, not authorization

`scripts/ops/ops-merge-wrapper.ts` is reusable for serializing the merge train. Its filesystem mutex does not prevent:

- GitHub UI merge;
- API merge outside the wrapper;
- admin bypass;
- auto-merge already armed before revocation;
- another machine without the local lock.

The GitHub required check must be the security boundary. The wrapper should additionally verify quorum and kill state, but must not be treated as sufficient.

### P2 — Existing certification machinery is unrelated

`scripts/ops/cert-check.ts` concerns product certification domains backed by Supabase. It should not be overloaded with T1-M authorization. Create a separate pure verifier for code-authorization artifacts.

### P3 — Design packet overstates expected throughput

The packet estimates 40–60% T1-M eligibility without a repository-derived sweep. That is not supportable yet.

The current T1 stream contains many governance, workflow, runtime, migration, contract, proof-repair, and authority-adjacent changes that the proposed rules correctly classify as T1-H. Recent T1 PRs also show several with multi-hour to multi-day elapsed time, but created-to-merged duration combines implementation, CI, repair, and human wait.

A trustworthy estimate requires a classifier replay over at least 100 recent merged T1 PRs.

## 3. Reusable controls

These can be retained after hardening:

- Strict required-status-check currency on `main`.
- Existing exact-head handling in `executor-result-validator.yml`, as an implementation pattern—not as an approval artifact.
- Mechanical tier floor and shared Tier C path lists.
- Merge mutex and serial merge-train mechanics.
- Proof binding and reviewed-head schema patterns.
- CI dispatch watchdog.
- Lane worktree, file-scope locking, and execution-location checks.
- `governance:pause` as an additional per-PR emergency block.
- `pnpm verify`, R-level checking, proof gates, P0 protocol, and live DB gates.
- Existing deploy workflow structure, after environment protection is added.

Do not reuse:

- `pm-verdict/v1` comment parsing;
- `t1-approved` as authority;
- lane-manifest tier as sole classification;
- executor self-attestation as review;
- current GitHub Actions App identity for distinct reviewer seats.

## 4. Exact repository implementation map

### Mandatory workflow changes

- `.github/workflows/merge-gate.yml`
  - Consume a trusted, tested quorum-verifier result.
  - Bind repository, PR, issue, head, current main, criteria, charter, roster, and policy revision.
  - Fail closed on missing or duplicate artifacts.
  - Stop accepting comments/labels on the T1-M path.
  - Run trusted logic from `main`, not PR head.

- `.github/workflows/tier-classifier-advisory.yml`
  - Retain advisory mode during bootstrap.
  - Eventually replace with a trusted classifier App/check, not PR-executed classifier code.

- New trusted workflows:
  - `.github/workflows/t1m-intake.yml`
  - `.github/workflows/t1m-review-dispatch.yml`
  - `.github/workflows/t1m-quorum-gate.yml`
  - `.github/workflows/t1m-timeout-watchdog.yml`
  - `.github/workflows/t1m-shadow-report.yml`

- `.github/workflows/deploy.yml`
  - Require protected environment approval.
  - Verify deployment SHA is reachable from protected `main`.
  - Prevent reviewer Apps from dispatching it.
  - Pin privileged actions to immutable SHAs.

- `.github/workflows/direct-main-push-guard.yml`
  - Add delegation-policy and privileged-check provenance validation.

- `.github/CODEOWNERS`
  - Keep Griff as owner of delegation, workflow, classifier, roster, and deployment surfaces.
  - Do not add reviewer Apps as code owners.

### Mandatory scripts

- `scripts/ops/tier-classifier.ts`
  - Split `minimumTier` from `t1mEligibility`.
  - T1-M must be deny-by-default and conjunctive.
  - Generate canonical classification input/output digests.

- `scripts/ops/merge-risk.ts`
  - Extract shared sensitive-path authority into a self-protected module or export versioned rules safely.
  - Preserve existing conflict behavior.

- New:
  - `scripts/ops/t1m-policy.ts`
  - `scripts/ops/t1m-artifact-schema.ts`
  - `scripts/ops/t1m-round.ts`
  - `scripts/ops/t1m-quorum-verify.ts`
  - `scripts/ops/t1m-authority-diff.ts`
  - `scripts/ops/t1m-kill-state.ts`
  - `scripts/ops/t1m-ledger-verify.ts`
  - `scripts/ops/t1m-shadow-sweep.ts`

- `scripts/ops/lane-start.ts`
  - Check the kill switch.
  - Require a trusted criteria snapshot and classifier artifact before T1-M dispatch.
  - Record round/context references, not mutable authority claims.

- `scripts/codex-dispatch.ts` and equivalent Claude dispatch tooling
  - Enforce T1-M eligibility and implementer identity.
  - Refuse dispatch when disabled, expired, ambiguous, or roster-invalid.

- `scripts/ops/merge-ready.ts`
  - Add quorum, current-main, kill-switch, and ledger verification.

- `scripts/ops/ops-merge-wrapper.ts`
  - Recheck kill state and complete authorization context immediately before each merge.
  - Never repost or synthesize reviewer verdicts.

- `scripts/ops/truth-check-lib.ts`
  - Understand T1-M authorization separately from legacy PM verdicts.
  - Require exact reviewed head and merge result.

- `scripts/ops/ci-dispatch-watchdog.ts`
  - Watch every required seat and round deadline.

- `scripts/ops/workflow-hardening.test.ts`
  - Assert trusted-ref execution, minimal permissions, action pinning, trigger coverage, and no PR-code execution with App secrets.

### Schemas and policy

Add versioned JSON schemas, not Markdown-only formats:

- `docs/05_operations/schemas/t1m-classification-v1.schema.json`
- `docs/05_operations/schemas/t1m-criteria-snapshot-v1.schema.json`
- `docs/05_operations/schemas/t1m-review-verdict-v1.schema.json`
- `docs/05_operations/schemas/t1m-authority-audit-v1.schema.json`
- `docs/05_operations/schemas/t1m-round-v1.schema.json`
- `docs/05_operations/schemas/t1m-ledger-event-v1.schema.json`
- `docs/05_operations/schemas/t1m-quorum-decision-v1.schema.json`

Policies requiring Griff/T1-H approval:

- `docs/05_operations/DELEGATION_POLICY.md`
- `docs/05_operations/REQUIRED_CI_CHECKS.md`
- `docs/05_operations/EXECUTION_TRUTH_MODEL.md`
- `docs/governance/LANE_TAXONOMY.md`
- `docs/05_operations/r1-r5-rules.json`
- `docs/governance/T1M_DELEGATION.json`
- `docs/governance/t1m-path-policy.json`
- `docs/governance/t1m-reviewer-roster.json`

The lane manifest schema and implementation must gain immutable references for criteria snapshot, classification, round ID, and implementer principal. These are evidence pointers, not authority by themselves.

No database migration is needed if the audit ledger is external. If repository policy requires a database-backed ledger, that becomes a separate Tier C migration and substantially expands bootstrap risk.

## 5. Required schemas and pseudocode

### Classification

```json
{
  "schema": "t1m-classification/v1",
  "repository_id": 123,
  "pr_number": 1250,
  "issue_id": "UTV2-1600",
  "head_sha": "40-hex",
  "base_ref": "main",
  "base_sha": "40-hex",
  "merge_base_sha": "40-hex",
  "criteria_sha256": "64-hex",
  "policy_revision": 1,
  "decision": "T1M_ELIGIBLE",
  "checks": {
    "paths_allowlisted": true,
    "deny_paths_absent": true,
    "dependency_change_absent": true,
    "migration_absent": true,
    "workflow_change_absent": true,
    "credential_change_absent": true,
    "network_egress_change_absent": true,
    "activation_change_absent": true,
    "revert_only_claim_proven": true
  },
  "matched_rules": [],
  "input_digest": "64-hex",
  "issuer_app_id": 12345
}
```

Any `false`, `unknown`, parser error, truncated diff, or unsupported file kind produces `T1H_REQUIRED`.

### Review verdict

```json
{
  "schema": "t1m-review-verdict/v1",
  "round_id": "64-hex",
  "seat": "technical",
  "implementer_principal": "claude-service",
  "reviewer_principal": "codex-review-service",
  "provider": "openai",
  "model": "exact-version",
  "provider_request_id": "opaque",
  "repository_id": 123,
  "pr_number": 1250,
  "issue_id": "UTV2-1600",
  "head_sha": "40-hex",
  "base_sha": "40-hex",
  "diff_digest": "64-hex",
  "criteria_sha256": "64-hex",
  "files_expected": ["..."],
  "files_inspected": ["..."],
  "verdict": "APPROVE",
  "findings": [],
  "prior_objections_addressed": [],
  "issued_at": "ISO-8601",
  "issuer_app_id": 12346,
  "signature": "service signature"
}
```

### Quorum verifier

```text
function authorize(pr):
    context = fetchLivePrFromGitHub(pr)

    require delegationVariable() == ENABLED
    charter = loadCharterFromCurrentMain()
    require charter.enabled && now < charter.expires
    require charter.revision is expected

    require context.baseRef == "main"
    require context.mergeable
    require context.behindBy == 0

    criteria = fetchTrustedCriteriaSnapshot(pr)
    classification = fetchClassifierCheck(pr.headSha)

    require classification.context == exactContext(context, criteria)
    require classification.decision == T1M_ELIGIBLE
    require classification.appId == roster.classifierAppId

    roundId = deriveRoundId(context, criteria, charter, roster, policy)

    events = fetchAndVerifyAppendOnlyLedger(pr)
    require events.roundId == roundId
    require bounceCount(events) <= 2
    require no identity anomaly
    require no classification dispute
    require no authority veto

    for seat in [technical, architecture, adversarial]:
        verdict = exactlyOneVerdict(events, seat, roundId)
        require verdict.appId == roster[seat].appId
        require verdict.verdict == APPROVE
        require verdict.filesInspected == context.changedFiles
        require verdict.diffDigest == context.diffDigest
        require verdict.implementerPrincipal != verdict.reviewerPrincipal
        require providerIndependenceRulesSatisfied()

    audit = exactlyOneAuthorityAudit(events, roundId)
    require audit.verdict == NO_EXPANSION

    require allRequiredChecksSuccessful(pr.headSha)

    # TOCTOU close
    live = fetchLivePrFromGitHub(pr)
    require live.headSha == context.headSha
    require currentMainSha() == context.baseSha
    require delegationVariable() == ENABLED
    require charterStillValid()

    return APPROVED_FOR_MERGE_ONLY
```

## 6. Required GitHub identities, secrets, and permissions

Minimum principals:

- `utv2-t1m-intake`
- `utv2-tier-classifier`
- `utv2-review-tech`
- `utv2-review-arch`
- `utv2-review-adv`
- `utv2-authority-audit`
- `utv2-quorum-gate`
- optionally `utv2-t1m-ledger`

Each must be a distinct GitHub App installation, not a workflow using `GITHUB_TOKEN`.

Reviewer Apps need only:

- Checks: write
- Pull requests: read
- Contents: read
- Metadata: read

They must not have:

- Contents: write
- Pull requests: write/merge
- Issues: write
- Actions: write
- Workflows: write
- Deployments: write
- Environments: write
- Variables/secrets: write
- Packages: write
- Administration: any

Secrets:

- App IDs
- installation IDs
- private keys, scoped one per protected environment or external reviewer service
- vendor API credentials, one per reviewer backend
- ledger signing key or managed signing identity
- alert endpoint

Do not place private keys on the shared WSL host or in a single orchestrator-visible repository secret set. Prefer external services or OIDC-federated secret retrieval.

Production environment:

- Griff required reviewer
- no reviewer App permitted to approve
- no admin bypass
- deployment branch restricted to protected `main`
- deployment SHA ancestry check

## 7. Fail-closed test matrix

| Area | Required failure test |
|---|---|
| Classification | Unknown path → T1-H |
| Classification | Classifier parse/error/timeout → T1-H |
| Classification | Workflow, policy, contract, migration, deploy, auth, env, dependency, lockfile change → T1-H |
| Classification | Renamed sensitive file → T1-H |
| Classification | Deleted sensitive file → T1-H |
| Classification | Symlink, submodule, binary, or truncated patch → T1-H |
| Identity | Correct check name from GitHub Actions App ID → reject |
| Identity | Wrong App ID or installation → reject |
| Identity | Two checks for one seat → reject and escalate |
| Identity | Implementer and reviewer principal match → reject |
| Replay | Correct verdict copied to another PR → reject |
| Replay | Correct verdict copied to another issue → reject |
| Replay | Verdict for old head after push → reject |
| Replay | Verdict after base/main advances → reject |
| Replay | PR retargeted away from main → reject |
| Criteria | Linear edited after snapshot → invalidate lane or require new snapshot |
| Criteria | Manifest hash edited without trusted snapshot → reject |
| Diff review | Missing changed file from `files_inspected` → reject |
| Diff review | GitHub patch truncated without full blob fetch → reject |
| Diff review | Summary supplied instead of fetched diff → reviewer workflow failure |
| Ledger | Deleted/missing prior rejection → reject |
| Ledger | Broken hash chain → reject |
| Shopping | Rerun after completed verdict → reject |
| Shopping | New head after authority veto → immediate T1-H |
| Bounce | Third repair head after two repairs → freeze/escalate |
| Kill switch | Disabled before dispatch → no lane |
| Kill switch | Disabled during review → no verdict published |
| Kill switch | Disabled after votes but before quorum → no quorum |
| Kill switch | Disabled after quorum but before merge → no merge |
| Kill switch | Disabled while auto-merge armed → auto-merge cancelled or required check turns red |
| Charter | Missing, malformed, expired, or future revision → reject |
| Merge | Admin/API/UI attempt without quorum required check → blocked |
| Deploy | Reviewer App attempts workflow dispatch → denied |
| Deploy | Non-main SHA requested → denied |
| Trusted code | PR modifies verifier while privileged workflow runs → workflow still uses trusted-main verifier |
| Injection | Instructions in code/comments/fixtures → treated as diff data |
| Availability | Seat timeout or vendor outage → block and alert, never degrade quorum |
| Concurrency | Main advances while multiple PRs approved → every stale PR re-reviews |

Tests must use `node:test` and `node:assert/strict`. Workflow topology tests belong in `workflow-hardening.test.ts`. A GitHub sandbox repository is required for App identity, environment protection, and branch-protection integration tests; unit tests cannot prove those controls.

## 8. Bootstrap and rollback

### Bootstrap

1. Griff approves the complete architecture and reviewer roster out of band.
2. Create the GitHub Apps and external reviewer services.
3. Install Apps with read/check-only permissions.
4. Protect production and canary environments.
5. Add schemas, pure verifiers, policy files, and shadow workflows.
6. Merge each bootstrap PR using the existing Griff-only T1 gate.
7. Run shadow mode with no machine merge authority.
8. Correct defects using the old Griff-only gate.
9. Add the T1-M required check while delegation remains disabled.
10. Verify disabled-state failure behavior.
11. Griff approves and merges a final activation PR setting the charter to enabled.
12. Griff flips the separately administered live variable only after the activation PR is on `main`.

At no point may the new quorum approve a PR that creates, modifies, enables, or expands its own authority.

### Rollback

Immediate:

- set `T1M_KILL=1`;
- cancel pending auto-merges;
- disable reviewer App installations if compromise is suspected;
- keep the quorum gate required and failing closed.

Repository rollback:

- Griff-approved revert of the activation PR;
- restore Griff-only T1 behavior;
- do not delete ledger history;
- rotate all App and vendor credentials implicated in an incident.

Deployment rollback remains separately Griff-authorized.

## 9. Minimal revised issue sequence

The packet’s five issues combine too many trust transitions. Minimum safe sequence is:

1. **Ratify taxonomy and root-of-trust architecture**  
   T1-H; policy only; define exact eligibility and Griff-reserved conditions.

2. **Build pure schemas, classifier, authority-diff, and quorum verifier**  
   No authority granted; exhaustive unit tests; classifier remains advisory.

3. **Create external identities and GitHub sandbox integration harness**  
   Apps, installations, provider attestations, ledger, identity-spoof tests.

4. **Add immutable criteria intake and round binding**  
   Trusted issue snapshot, issue/PR/head/main/diff binding.

5. **Add shadow reviewer fan-out and watchdog**  
   No merge authority; gather real performance and disagreement data.

6. **Harden GitHub branch and deployment protection**  
   Admin enforcement, environment reviewers, action pinning, permission reductions.

7. **Add disabled T1-M branch to Merge Gate**  
   Required check present but charter and kill state keep it non-authorizing.

8. **Run acceptance campaign and publish sweep results**  
   At least 30 eligible and 30 ineligible historical/live cases, plus adversarial exercises.

9. **Final Griff activation PR**  
   Enables a narrowly scoped pilot; cannot be quorum-approved.

## 10. Pilot constraints

- Shadow mode for at least 30 completed T1 reviews, not merely two weeks.
- Zero classifier false-positive T1-M decisions.
- Initial live allowlist limited to test-only changes outside sensitive paths and narrowly selected non-runtime utilities.
- Exclude:
  - `packages/domain/**`
  - `packages/contracts/**`
  - `packages/db/**`
  - `apps/worker/**`
  - API service/write paths
  - workflows and CI authority
  - scripts capable of dispatch, merge, certification, deployment, or production mutation
  - configuration, dependencies, lockfiles, infrastructure, docs that define policy
- One live T1-M lane at a time initially.
- No auto-merge during the first live phase.
- Griff reviews every pilot merge within 24 hours.
- Immediate kill on any identity anomaly, authority dispute, missed diff file, unexpected deploy ability, or for-cause revert.
- Two repair rounds maximum.
- Charter expiry initially 14 days.
- No widening until at least 20 live merges without security or classification incident.

## 11. Conditions under which Griff must still approve

Griff remains mandatory for:

- any T1-H or ambiguous classification;
- delegation, classifier, allowlist, denylist, roster, quorum, ledger, kill-switch, or merge-gate changes;
- GitHub App creation, installation, permission, or credential changes;
- branch protection, environment protection, required-check, CODEOWNERS, and Actions-permission changes;
- workflow or deployment changes;
- migrations and live data mutation;
- contracts, domain policy, grading, settlement, promotion, financial, auth, privacy, credentials, and external integrations;
- dependency or lockfile changes;
- member-visible activation;
- production deployment, feature activation, cron enablement, and rollback;
- any authority-audit veto or classifier dispute;
- bounce-cap exhaustion;
- security incident recovery;
- pilot expansion and charter renewal;
- any case where reviewer identity or complete-diff coverage cannot be proven.

## 12. Estimated throughput gain

The packet’s 80–95% T1-M latency reduction is plausible only for a genuinely eligible PR after infrastructure is stable. Its claim that 40–60% of current T1 work is eligible is unsupported and likely high for this repository.

A defensible preliminary estimate is:

- Eligible share of current T1 train: approximately 15–30%.
- Eligible PR authorization time: approximately 20–90 minutes with no repair.
- End-to-end T1 throughput gain across the whole train: approximately 10–25%.
- Human approval workload reduction: approximately 15–30%, with Griff’s remaining reviews concentrated on higher-risk changes.

Main-advance invalidation will create review convoys under the current strict merge train. At high concurrency, reviewer time may exceed human-wait savings unless the queue classifies and reviews only the next merge candidate. A historical sweep must replace these estimates before ratification.

## 13. Final corrected plan for Claude/Fable 5

1. Treat this verdict as `REVISE`; do not activate or implement merge authority yet.
2. Rewrite the design so T1-M is a conservative, deny-by-default eligibility proof—not a general T1 subclass.
3. Remove `packages/domain/**` from the pilot.
4. Define Griff, protected `main`, and protected deployment environments as the root of trust.
5. Replace nonce language with a deterministic complete-context `round_id`.
6. Replace comment/label approval with separately installed App-authored, signed check artifacts.
7. Require external reviewer services; GitHub Actions jobs alone are not distinct model identities.
8. Ensure privileged workflows execute only trusted code from current `main`.
9. Add immutable pre-execution criteria snapshots issued by a trusted intake principal.
10. Require each reviewer to independently fetch and digest the full GitHub diff and attest complete file coverage.
11. Store review history in an append-only, hash-chained ledger; never use latest-check-wins.
12. Check the kill switch at dispatch, review start/end, quorum, merge readiness, merge execution, reconciliation, and deployment boundaries.
13. Make classification disputes and authority vetoes immediate T1-H escalations.
14. Limit ordinary repair to two rounds after the initial review.
15. Protect production with Griff-required environment approval and remove admin bypass.
16. Keep classifier and quorum workflows advisory/disabled through bootstrap.
17. Merge every bootstrap and activation change under the existing Griff-only T1 process.
18. Run the historical sweep, GitHub sandbox attack suite, and 30-review shadow campaign.
19. Activate only through a final Griff-approved PR plus separately controlled live variable.
20. Preserve a one-action rollback: kill variable first, then Griff-approved charter revert.

---

No implementation was performed as part of this review. The original design packet was not modified.
