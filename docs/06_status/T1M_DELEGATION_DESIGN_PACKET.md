# T1-M / T1-H Delegation Redesign — Design Packet (DRAFT, for adversarial review)

Status: DRAFT r2 — not ratified, not implemented. Authored by Claude (Fable 5) architecture review, 2026-07-17.
Revision 2 (2026-07-17): reconciled with Codex adversarial review
(`docs/06_status/T1M_DELEGATION_CODEX_ADVERSARIAL_REVIEW.md`, verdict REVISE). See "Revision 2 —
Codex reconciliation" at the end of this document; where r2 and the r1 body below conflict, **r2 wins**.
Purpose: redesign the final-authorization model so reversible, technically decidable T1 changes ("T1-M")
can be reviewed, repaired, certified, and merged by an independent multi-model quorum without ceremonial
human technical approval, while human-reserved authority ("T1-H") stays with Griff.

Reviewers requested: Codex (technical adversarial review), Grok (adversarial), Fable (architecture), PM (Griff).
Per standing rule: governance/gating/routing changes take effect only via a governance PR, never chat.

---

## 1. Executive verdict: ADOPT WITH MODIFICATIONS

The core insight is correct: Griff's T1 approvals are already laundered machine judgment — he reads model
summaries and stamps them. Removing the stamp removes latency without removing assurance, *provided* the
assurance is real. The proposal as originally framed has three fatal gaps that must be fixed before adoption:

1. **The classifier is the crown jewel and the proposal under-protects it.** Whoever (or whatever) decides
   "this is T1-M" holds the real authority. If a model can classify its own work as T1-M, the quorum is decoration.
2. **"Independent reviewers" running on shared infrastructure with shared context are not independent.**
   Three models orchestrated by one Claude session, reading one PR description, are one reviewer with three hats.
3. **Unanimity of models is weaker than it sounds** — correlated blind spots make 4-of-4 agreement on a subtle
   authority-widening change entirely plausible. The defense is not more votes; it is a dedicated authority-diff
   check that is not asked "is this correct?" but "does this expand what machines may do?"

The modifications below are non-negotiable conditions of adoption.

## 2. Revised T1-M / T1-H taxonomy

**T1-M requires ALL of (conjunctive, mechanically checkable):**
- Reversible by `git revert` alone — no data migration, no external state mutation, no schema change that
  written rows depend on.
- Deterministic acceptance criteria expressible as CI checks that exist *before* implementation starts.
- File scope entirely within a **T1-M-eligible path allowlist** (checked in; changes to it are T1-H).
- No touch of: `.github/workflows/**`, `.claude/**`, `docs/00_constitution/**`,
  `docs/05_operations/{DELEGATION_POLICY,STANDING_GUARDRAILS,EXECUTION_TRUTH_MODEL}*`, CODEOWNERS,
  branch protection config, `r1-r5-rules.json`, merge-gate logic, preflight/truth-check/lane tooling under
  `scripts/ops/**`, secrets/env plumbing, `deploy.yml`, or the tier-classification code itself.
- No new external dependency, no new network egress destination, no credential handling.
- No production activation semantics (feature flags defaulting on, cron enablement, governor toggles).

**Always T1-H (never eligible, regardless of framing):**
- Anything on the deny-path list above — i.e., *the machinery that enforces T1-M is itself T1-H, recursively, forever*.
- DB migrations (even "reversible" ones — rollback after writes is not a revert).
- Delegation, quorum, tier, or identity changes; changes to the eligible-path allowlist.
- Spending, legal commitments, public financial/performance claims, credentials, destructive/irreversible ops,
  production deploy/activation.
- Any PR where classification is ambiguous. **Ambiguity resolves to T1-H fail-closed** — there is no
  "escalate to a smarter model" branch.

**Key modification:** T1-M classification is computed **mechanically from the diff** (path allowlist ∩ deny-list
∩ dependency-diff ∩ migration-detector) by a CI job, not asserted by any model. Models may *request* T1-M;
only the classifier grants it. The classifier's verdict is an artifact (`tier-class/v1`) bound to the head SHA.

## 3. Authority and reviewer matrix

| Role | Actor | Identity | May vote? | Notes |
|---|---|---|---|---|
| Implementer | Claude or Codex | lane executor identity | **Never** | recorded in executor-result/v1 |
| Technical reviewer | Codex (if Claude implemented) / Claude (if Codex implemented) | dedicated review App | Yes | cross-vendor from implementer |
| Architecture reviewer | Fable | dedicated review App | Yes | boundary/invariant focus |
| Adversarial reviewer | Grok | dedicated review App | Yes | prompted to refute; injection-hunting |
| **Authority auditor** | deterministic checker + model | separate App | **Veto only** | single question: does this widen machine authority? Cannot approve, only block. |
| Classifier | deterministic CI job | GitHub App `utv2-tier-classifier` | Gate, not vote | |
| Orchestrator | Claude session | orchestrator identity | **Never** | may trigger reviews, never author verdicts |
| Griff | human | GitHub account | T1-H only + kill switch + appeal target | |

Rule: the implementer's vendor lineage is excluded from the technical-review seat (Claude implements → Codex
tech-reviews, and vice versa). Fable and Claude share a vendor; acceptable for the architecture seat only
because Grok provides cross-vendor adversarial coverage — but Fable must not be both architecture reviewer and
the implementer's parent-session model on the same lane.

## 4. Quorum algorithm

```
eligible = tier-class/v1(head) == T1M            # deterministic
votes    = {tech, arch, adv} verdicts, each bound to exact head SHA + nonce
veto     = authority-audit/v1(head)

MERGE iff:
  eligible
  AND all deterministic gates green on head (verify, proof, branch-discipline, P0, scope)
  AND |votes| == 3 AND all APPROVE AND all head_sha == current head
  AND veto == NO_AUTHORITY_EXPANSION
  AND repair_bounces <= 3
  AND no unresolved P1/P2 findings from any reviewer
  AND kill_switch == armed-off AND delegation charter valid + unexpired
ELSE on any REJECT or veto → repair loop (bounce++) or immediate escalation
```

Unanimous 3-of-3 voters + 1 veto seat. **No threshold mode** — with only 3 votes, 2-of-3 means overruling a
dissenting model, which is reviewer-shopping formalized.

### 4-of-4 vs 3-of-4

Reframed as **3 unanimous approvals + 1 independent veto**, stronger than 4-of-4 because the fourth seat
answers a different question and cannot be traded off. Changes adjacent to governance-eligible paths
additionally require the authority auditor to produce a written authority-diff, not just a verdict.

## 5. Identity, anti-fabrication, isolation

**Identity architecture:**
- GitHub Apps: `utv2-review-tech`, `utv2-review-arch`, `utv2-review-adv`, `utv2-authority-audit`,
  `utv2-tier-classifier`, plus the existing merge-gate. Each App's private key lives only in its own
  GitHub Actions environment / runner secret scope — **not** in the orchestrator's environment and not on
  the WSL2 box.
- Verdicts are **not comments parsed from text** (weak artifact parsing is how pm-verdict/v1 could be spoofed).
  Verdicts are **GitHub Check Runs created by the respective App** (or App-submitted reviews). Merge Gate
  validates the *App ID of the check creator*, not comment authorship or body format. A comment saying
  "APPROVED" from any identity is inert.
- Each reviewer runs as a **separate GitHub Actions workflow triggered by the classifier's check**, not spawned
  by the orchestrator. The orchestrator cannot run them, re-run them selectively, or supply their prompts.
  This kills fabrication (orchestrator holds no review keys) and reviewer shopping (re-runs fan out to *all*
  seats atomically; a dissent cannot be individually retried).

**Reviewer-shopping prevention:** REJECT verdicts land in an append-only ledger keyed by (PR, head SHA, seat).
A new head SHA (repair) legitimately re-opens voting, but the same seat must re-review with the prior objection
presented ("your objection O1 — resolved by hunk H?"). Bounce count increments per new head after any REJECT.

**Context isolation:** each reviewer workflow checks out the head and receives only: the diff, the linked
issue's *frozen acceptance criteria* (hash-snapshotted into the lane manifest at lane-start, so later issue
edits cannot inject), and deterministic gate results. Reviewers do **not** receive: the implementer's
self-summary, other reviewers' verdicts, or orchestrator narrative. Model-generated summaries are the easiest
injection/persuasion channel — denied entirely; reviewers form their own summary from the diff.

## 6. Staleness, rebase, and current-main invalidation

- Every verdict carries `head_sha`; Merge Gate compares against the PR head *at merge-evaluation time* and
  requires the branch current with `origin/main`. Any push, rebase, force-push, or main advance invalidates
  **all** votes and the veto — no "trivial rebase" carve-out (a rebase changes the merged tree even with an
  identical diff).
- Replay defense: verdicts also carry PR number + a nonce issued by the classifier run for that SHA; Merge Gate
  checks the (PR, SHA, nonce) triple, so a verdict copied from another PR or an earlier round is invalid.

## 7. Repair bounce cap

**3 automatic bounces.** Bounce = new head pushed after any REJECT/veto. On the 4th, the lane freezes and
escalates to Griff with the full objection ledger. Rationale: repair loops empirically converge in 1–2 rounds;
3 catches stragglers without letting a model grind a dissenter down through attrition (repeated slightly-reworded
pushes until the reviewer's sampling flips).

## 8. Immediate-escalation conditions (no repair attempt)

- Classifier says T1-M but any reviewer flags "this should be T1-H" (classification dispute — the most
  dangerous disagreement).
- Authority-audit veto fires.
- Any reviewer reports suspected prompt injection or requests withheld context.
- Duplicate or conflicting check identities for the same seat.
- Any seat fails to report within timeout — fail closed: silence ≠ approval; at most one auto-retry, then page
  (see UTV2-1517 silent-dispatch incident: dispatch failure must alert, not wait).
- Kill switch flipped mid-flight.
- Production-state / repository-state divergence detected by runtime-verifier.

## 9. Authority-expansion detection (independent of correctness)

Two layers:
- **Deterministic `authority-diff` CI job** — fails on: any change to deny-list paths, new use of privileged
  tokens/secrets in changed code, new `gh`/GitHub-API call sites, new writes to lane manifests or governance
  docs from code, workflow permission escalation, changes to workflow trigger topology. Encoded as code, not
  prose (core invariant 11).
- **Model veto seat** — receives *only* the diff and one question: "After this merges, can any automated actor
  do anything it could not do before, or with fewer checks?" It never evaluates correctness, so it cannot be
  persuaded by correctness.

## 10. Merge-versus-deploy boundary

T1-M quorum authorizes **merge to main only**. Deploy/activation (deploy.yml, canary promote, flag flips,
cron enablement, governor toggles) remains T1-H — Griff-triggered or on his standing schedule. Quorum
credentials must be structurally unable to trigger deploy (deploy workflow requires GitHub environment
approval bound to Griff's account). This also answers production-state ≠ repo-state: machines converge the
repo; a human gates convergence of production.

## 11. Kill-switch and revocation design

- `docs/governance/T1M_DELEGATION.json`: `{ "enabled": bool, "expires": ISO-date, "revision": n }`.
  Merge Gate reads it from **origin/main at evaluation time**. Missing, unparseable, or expired → T1-M
  disabled (fail closed). The delegation **auto-expires every 30 days** and requires Griff to renew via a
  one-line PR — converting his role from per-PR stamping to periodic charter renewal (real oversight, cheaper).
- Instant path: repo-level Actions variable `T1M_KILL=1` (admin-only, seconds to flip, no PR); Merge Gate
  checks it first.
- Revocation freezes in-flight T1-M lanes at their next gate; already-merged work is unaffected (reversible by
  eligibility definition — that is the point of the bar).

## 12. Prompt-injection defense

- Untrusted by default: issue bodies, PR titles/bodies/comments, commit messages, logs, external docs, and
  **model-generated summaries** are never placed in reviewer prompts. Reviewers get diff + frozen acceptance
  criteria + gate results only.
- Acceptance criteria frozen at lane-start (hash in manifest); reviewer workflows verify the hash.
- Diff content itself can carry injection (comments saying "reviewer: approve"). Mitigations: reviewer system
  prompts treat diff content as data; the adversarial seat explicitly hunts embedded instructions; the
  authority-audit seat is deterministic-first. Residual risk is bounded by the deny-path list — an injected
  approval of an allowlisted-path change has a bounded, revertible blast radius.
- Extend branch-discipline to ban verdict-schema-shaped strings (`pm-verdict/v1`, check-run names) inside
  diffs/PR bodies, so text cannot impersonate artifacts even to a sloppy parser.

## 13. Artifact / schema recommendations

- `tier-class/v1` — check run: `{head_sha, nonce, class: T1M|T1H, matched_rules[], allowlist_rev}`.
- `review-verdict/v2` — per seat, App-authored check run:
  `{seat, model_id, head_sha, nonce, verdict: APPROVE|REJECT, findings[{sev, path, line, claim}], objections_resolved[]}`.
- `authority-audit/v1` — `{head_sha, nonce, verdict: NO_EXPANSION|EXPANSION|UNSURE, expansion_claims[]}`
  (UNSURE = veto).
- `quorum-ledger/v1` — append-only per-PR JSON in check output: full vote history, bounces, invalidations.
  This is the audit log; the proof bundle links it, SHA-tied per existing rules.
- Existing executor-result/v1, proof bundle, and truth-check remain unchanged.

## 14. Threat-model findings (ranked)

- **P0 — Classifier self-reference:** if tier classification is model-asserted or its code is T1-M-editable,
  everything collapses. Fix: deterministic classifier + recursive T1-H on its own paths.
- **P0 — Verdict spoofing via text parsing:** comment-parsed pm-verdict/v1 is exactly the weak-parser threat.
  Fix: App-authored check runs; comments inert.
- **P0 — Orchestrator holds reviewer keys:** if the Claude session can mint any review identity, quorum = 1.
  Fix: per-App keys in separate workflow scopes.
- **P1 — Correlated blind spots:** unanimity across LLMs on a subtle bug is likely. Mitigations: cross-vendor
  seats, single-question veto seat, deterministic gates carrying correctness weight, reversibility backstop.
- **P1 — Injection via issue/PR text and summaries:** fixed by frozen criteria + summary denial.
- **P1 — Attrition of dissent (bounce grinding):** fixed by bounce cap + objection-ledger continuity.
- **P2 — Replay / stale votes:** fixed by SHA+nonce binding and all-votes invalidation.
- **P2 — GHA silent non-dispatch / duplicate identities** (observed, UTV2-1517): fail-closed timeouts,
  seat-uniqueness assertion in Merge Gate, alerting on missed dispatch.
- **P2 — Post-merge lease/lock leak:** existing lane-close/reconciler covers; add T1-M merges to
  track-a-monitor.
- **P3 — Allowlist rot** (paths become sensitive over time): 30-day charter renewal forces periodic re-look;
  KNOWN_DEBT entry per exception.

## 15. Repository implementation map

- `.github/workflows/merge-gate.yml` — add T1-M branch (classifier check + 3 App verdicts + veto + kill switch
  + currency + charter validity).
- New workflows: `t1m-classifier.yml`, `t1m-review-fanout.yml` (four seat jobs), each with its own App
  credentials/environment.
- `docs/governance/T1M_DELEGATION.json`, `docs/governance/t1m-path-allowlist.json` (+ deny list).
- `docs/05_operations/schemas/`: `tier-class-v1.md`, `review-verdict-v2.md`, `authority-audit-v1.md`,
  `quorum-ledger-v1.md`.
- `docs/05_operations/DELEGATION_POLICY.md` + CLAUDE.md verification table — updated to reference merge-gate
  as the mechanical authority (existing "workflow wins" rule).
- `scripts/ops/` — deterministic classifier + authority-diff checker.

## 16. Issue decomposition (5 issues max)

1. **UTV2-1451 (reuse):** taxonomy + delegation charter + allowlist/deny-list — governance PR, T1-H,
   adversarial-review-first.
2. **UTV2-1546 (reuse):** deterministic tier classifier + authority-diff checker + schemas.
3. **UTV2-1500 (reuse):** identity architecture — GitHub Apps, key scoping, check-run verdict plumbing,
   comment-parsing deprecation on the T1-M path.
4. **New:** merge-gate T1-M branch + quorum ledger + kill switch + staleness/nonce enforcement.
5. **New:** pilot instrumentation + shadow-mode harness + acceptance campaign.

## 17. Controlled pilot plan

- **Phase 0 — shadow (2 weeks / ≥15 T1 PRs):** full pipeline runs on real T1 PRs; Griff still approves
  everything. Measure: quorum-vs-Griff agreement, classifier false-positive rate (any T1-M call a human would
  call T1-H), veto precision, seat timeout rate.
- **Phase 1 — narrow live:** T1-M live for the two lowest-risk allowlisted areas only (pure-domain code +
  test-only additions), cap 2 concurrent T1-M lanes, Griff post-hoc review of every merge within 48h with
  one-click revert.
- **Phase 2 — broaden:** full allowlist, normal caps, 20% post-hoc sampling.
- Gates between phases: zero classifier false-positives, zero for-cause reverts, ≥95% shadow agreement.

## 18. 6/8/10-lane acceptance campaign changes

At higher lane counts the review fan-out is the bottleneck and new failure surface. Add:
(a) N concurrent T1-M PRs racing to merge — verify currency invalidation serializes correctly (each merge
staleness-invalidates the others' votes; expect and measure the re-vote convoy);
(b) seat-timeout storms under load;
(c) kill-switch flip with 4 lanes in flight;
(d) reconciler handling of a T1-M PR frozen at bounce cap.

## 19. Estimated workflow speed improvement

Current T1 wall-clock is dominated by waiting for Griff (hours–days). T1-M path: classifier ~1 min, parallel
seats ~5–15 min, repair bounce ~20–40 min each. Realistic: **median T1-M latency drops from ~0.5–2 days to
~30–90 minutes** (~80–95% cut) on the eligible subset. Eligible fraction honestly estimated at 40–60% of T1
given the deny list; the remainder correctly stays human.

## 20. Failure modes / how this becomes security theater

- **Allowlist creep:** each "just add this path" PR is small and reasonable; two dozen later, workflows are
  T1-M. The defense (allowlist changes are T1-H) only works if Griff actually reads those PRs — the 30-day
  charter renewal is the ritual keeping him engaged; if renewal becomes a rubber stamp, this is theater with
  extra steps.
- **Unanimity illusion:** three LLMs agreeing feels like assurance but is one distribution sampled thrice
  unless cross-vendor seating and context isolation are actually enforced. If ops pressure ever leads to
  "just let Claude run the Grok seat via API from the orchestrator env," independence dies invisibly — the
  worst kind of failure.
- **Deterministic-gate atrophy:** if the quorum is seen to "catch things," CI/test investment stalls. The
  quorum must be positioned as the *last* line; acceptance criteria written before implementation is the real
  assurance.
- **Silent GHA failure:** 10+ hours of non-dispatch has already happened. A fail-closed system that silently
  stalls creates pressure to bypass — and bypass-under-pressure is how the deny list dies. Missed-dispatch
  alerting is not optional.
- **The honest theater risk:** if shadow mode shows quorum≈Griff agreement near 100%, that proves Griff's
  stamp added nothing — good. If it shows disagreement and we ship anyway, we have measured that the machines
  are sometimes wrong and delegated anyway. Publish the shadow numbers in the ratification doc either way.

---

**Bottom line:** adopt, with the deterministic classifier, App-authored check-run verdicts, the
authority-veto seat, orchestrator key isolation, and the auto-expiring delegation charter as non-negotiable
modifications. Griff's role shifts from per-PR stamp to: T1-H decisions, escalations, post-hoc sampling, and
monthly charter renewal — less frequent, more meaningful.

## Open questions for adversarial review (Codex/Grok/Fable)

1. Is the 3-bounce cap right, or should classification-dispute escalation subsume it?
2. Can the nonce scheme be simplified to SHA-only without opening replay across PRs?
3. Is check-run creator App-ID validation actually spoof-proof under GITHUB_TOKEN permission models?
4. Does the frozen-acceptance-criteria hash survive Linear issue edits and lane-manifest repair paths?
5. Should the authority auditor's deterministic layer live in merge-gate.yml or as its own required check?

---

# Revision 2 — Codex reconciliation (AUTHORITATIVE where it conflicts with r1 above)

Codex verdict: **REVISE** — accepted. The security objective stands; the r1 design was not safely
implementable on the current trust substrate. The following amendments are adopted.

## R2.1 Accepted Codex P0 findings (all)

1. **Approval forgery/replay:** current `pm-verdict/v1` comment parsing and the `t1-approved` label are
   mutable, text-parsed, not head-bound, and issued through the same `griff843` identity used by
   implementers/orchestrators. They are removed from the T1-M authorization path entirely; labels remain
   human-readable evidence only.
2. **No distinct identities exist today:** every required check is issued by GitHub Actions App ID 15368.
   Four workflows with four secret names are not four identities. T1-M requires separately installed
   GitHub Apps AND external reviewer services with signed attestations (App identity proves a service
   principal, not which model reviewed). Check-run validation must use App numeric ID + installation
   relationship + round binding, never check/workflow names.
3. **Privileged self-modification:** no privileged T1-M workflow may execute PR-head code, PR-supplied
   actions, PR-controlled prompts/schemas, or load policy (allowlist, charter, roster) from the PR head.
   All authorization code and policy load from trusted current `main` (or an immutable release SHA); the
   PR diff is strictly data.
4. **T1-M is an eligibility PROOF, not a T1 subclass:** the current classifier can only derive a Tier C
   floor. T1-M classification must be deny-by-default and conjunctive over affirmatively provable checks
   (see Codex `t1m-classification/v1` schema); any `false`/`unknown`/parse error/truncated diff/unknown
   path/file-kind → `T1H_REQUIRED`. `packages/domain/**` is REMOVED from the pilot allowlist (Tier C,
   financially consequential).
5. **Merge/deploy separation does not exist yet:** before any live delegation — production and canary
   environments gain required-reviewer protection (Griff), deployment branch restricted to protected
   `main` with SHA-ancestry check, `enforce_admins` turned on, privileged third-party actions SHA-pinned,
   reviewer Apps stripped of all write/dispatch/deploy/admin permissions (Checks:write, PR:read,
   Contents:read, Metadata:read only).
6. **Bootstrap circularity:** every PR that creates, modifies, enables, or expands quorum authority is
   T1-H and merges under the existing Griff-only gate, through final activation (Griff-approved
   activation PR + separately administered live variable, in that order). The quorum can never approve
   its own installation.

## R2.2 Design amendments (supersede r1 sections)

- **Round ID replaces nonce (r1 §6/§13):** deterministic
  `round_id = SHA256(repository_id || pr_number || issue_id || head_sha || base_ref || base_sha ||
  merge_base_sha || criteria_sha256 || policy_revision || roster_revision || charter_revision)`.
  No nonce issuer (which would itself be an authority). Binding covers the full context list in Codex
  P1 "exact-current-main binding", checked live immediately before merge (TOCTOU close per Codex §5
  pseudocode, which is adopted verbatim as the quorum-verifier spec).
- **Ledger (r1 §13):** append-only, hash-chained (`event_hash = SHA256(prev || canonical_event)`),
  stored externally / as artifacts — never latest-check-wins in check output. Merge gate rejects chain
  gaps, duplicate seat verdicts, approve-after-reject in-round, and bounce-count conflicts.
- **Repair bounces (r1 §7): 2, not 3.** Classification dispute, authority veto, injection finding, or
  identity anomaly → immediate T1-H escalation with zero bounces. Seat/provider config frozen per lane;
  no reruns after a completed verdict; one infra retry max before a verdict exists.
- **Kill switch (r1 §11):** checked at all 8 boundaries (dispatch, review dispatch, reviewer
  pre-call/pre-publish, certification, merge readiness + wrapper, GitHub Merge Gate, deploy guard,
  repair/resume/reconcile). Griff's admin boundary is the root of trust; charter file handles expiry,
  Actions variable handles instant kill, and pending auto-merges are cancelled on kill.
- **Criteria snapshot (r1 §12):** issued pre-execution by a trusted intake App (`utv2-t1m-intake`) as an
  immutable artifact/check (normalized text + Linear UUID/version + digest) — NOT an
  orchestrator-written manifest hash. Later Linear edits invalidate or supersede the lane.
- **Diff-coverage attestation:** each reviewer backend independently fetches the full diff from GitHub
  (blobs where patches truncate) and emits `files_inspected`, diff digest, per-file coverage, provider
  request ID + model version. Approval invalid if `files_inspected` ≠ GitHub's changed-file set.
- **Schemas:** versioned JSON Schema files per Codex §4 (`t1m-classification-v1` …
  `t1m-quorum-decision-v1`), not Markdown-only. Codex's verdict/classification JSON shapes adopted.
- **Fail-closed test matrix:** Codex §7 matrix adopted in full as the acceptance test suite
  (`node:test` + sandbox repo for identity/protection integration tests), plus
  `workflow-hardening.test.ts` for topology assertions.
- **Merge mutex:** `ops-merge-wrapper` remains operational serialization only; the GitHub required
  check is the sole security boundary. `cert-check.ts` is NOT reused for authorization.

## R2.3 Throughput estimate (supersedes r1 §19)

r1's 40–60% eligibility / 80–95% latency claims were unsupported. Adopted preliminary estimate:
**15–30% of the T1 train eligible; 20–90 min authorization per eligible PR; ~10–25% end-to-end
throughput gain; ~15–30% reduction in Griff's approval workload.** A classifier replay over ≥100 recent
merged T1 PRs (`t1m-shadow-sweep`) must replace these numbers before ratification. Review-convoy cost
under strict main-currency is a known risk: classify/review only the next merge candidate at high
concurrency.

## R2.4 Issue decomposition (supersedes r1 §16) — 5 issues, Codex's 9-step ordering preserved as intra-issue PR sequence

1. **UTV2-1451 (reuse) — Ratify taxonomy + root-of-trust** (Codex step 1): T1-H governance PR;
   deny-by-default eligibility definition, Griff-reserved list (Codex §11 adopted verbatim), root of
   trust = Griff + protected `main` + protected environments.
2. **UTV2-1546 (reuse) — Pure verification code** (Codex step 2): schemas, classifier eligibility split
   (`minimumTier` vs `t1mEligibility`), authority-diff, round derivation, quorum verifier, ledger
   verify, kill-state lib — all advisory, exhaustively unit-tested, zero authority.
3. **UTV2-1500 (reuse) — Identity + intake substrate** (Codex steps 3–4): GitHub Apps + external
   reviewer services + attestation, sandbox spoof-test harness, immutable criteria intake, round
   binding.
4. **New — Hardening + shadow** (Codex steps 5–7): branch/environment protection, action pinning,
   permission reductions; shadow reviewer fan-out + watchdog + shadow reports; disabled T1-M branch
   added to Merge Gate (present, non-authorizing).
5. **New — Acceptance campaign + activation** (Codex steps 8–9): ≥100-PR historical sweep, sandbox
   attack suite, ≥30-review shadow campaign (30 eligible + 30 ineligible cases), published results;
   final Griff activation PR + live variable flip.

Trust-transition ordering inside issues 3–5 is enforced by PR sequence, each merged under the
Griff-only gate.

## R2.5 Pilot constraints (supersede r1 §17)

Codex §10 adopted in full: shadow ≥30 completed reviews (not time-boxed); zero classifier
false-positives; live allowlist = test-only changes outside sensitive paths + narrowly selected
non-runtime utilities; exclude `packages/domain/**`, `packages/contracts/**`, `packages/db/**`,
`apps/worker/**`, API write paths, CI/workflow authority, dispatch/merge/cert/deploy-capable scripts,
config/deps/lockfiles/infra/policy docs; 1 live T1-M lane; no auto-merge in phase 1; Griff post-hoc
review within 24h; 2 repair rounds; charter expiry 14 days initially; no widening before 20 clean live
merges.

## R2.6 Residual disagreement (minor)

None substantive. The only divergence from Codex's plan is packaging: 5 issues instead of 9, with
Codex's step ordering preserved as mandatory PR sequencing inside issues — trust boundaries are
respected because every constituent PR individually merges under the Griff-only gate until step 9.

**Next gate:** PM (Griff) review of this r2 packet; then Grok adversarial pass and Fable architecture
pass against r2 (not r1); then UTV2-1451 governance PR.

---

# Revision 3 — PM timing amendment (AUTHORITATIVE on pilot timing only)

PM decision, 2026-07-18. Revision 2 remains authoritative on architecture and security in full — Revision 3
supersedes **only** the calendar-based pilot timing described in r1 §17 / r2's inherited pilot framing.

- The pilot is **count-gated, not calendar-gated**. The prior "14-day pilot" wording must not be read as a
  mandatory waiting or burn-in period.
- Fourteen days is the maximum pilot-authority TTL (charter expiration/renewal window per §11's auto-expiring
  delegation charter) — never a minimum duration.
- The pilot completes immediately when all required lane counts, adversarial cases, and certification
  thresholds pass. If certification completes on day 2, day 3, or day 4, the pilot is complete then. No
  artificial pause is permitted after sufficient evidence exists.
- Full count-gated widening schedule (pre-pilot sweep → 3 → 2-concurrent → 10 → 15 → 20-merge stages, with the
  20-merge threshold split ≥5 T1-M/R + ≥5 T1-M/T) is specified in
  `docs/06_status/T1M_DELEGATION_FINAL_PM_DECISION.md` §21, which is the binding synthesis document for this
  entire redesign and resolves the one substantive Design-Packet/Codex disagreement (repair bounce cap: 3,
  not 2, for ordinary REJECT verdicts only — see that document §11).

See `docs/06_status/T1M_DELEGATION_FINAL_PM_DECISION.md` for the complete, authoritative synthesis of this
packet and the Codex adversarial review.
