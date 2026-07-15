# Incident — `INC-2026-07-14-utv2-1533-direct-main-push`

## Header

| Field | Value |
|---|---|
| Incident ID | `INC-2026-07-14-utv2-1533-direct-main-push` |
| Title | Unauthorized direct push to `main` during a lane's post-merge proof-binding closeout |
| Severity | `Medium` |
| Status | `Open` |
| Detected | `2026-07-14T23:06:58Z` |
| Resolved | `n/a` — remediation not yet merged as of this record's authoring |
| Primary Linear | `UTV2-1537` — https://linear.app/unit-talk-v2/issue/UTV2-1537/ |
| Related issues | the concurrency ramp lane whose post-merge closeout this incident occurred during (referenced by GitHub PR #1216 only in this record's prose, per this repo's own commit/PR-text discipline convention — the full issue ID is used freely elsewhere in this file since a file's content, unlike a commit/PR title/body, is not scanned by Branch Discipline Guard) |
| Fix PR | pending — this lane's own PR (opened after this record; not yet merged at authoring time) |
| Fix commit | pending |
| Owner | claude (UTV2-1537 lane) |

## Severity justification

`Medium`, not `Low` or `High`:

- Not `Low`: this is a real, confirmed bypass of a ratified governance control (`docs/05_operations/DIRECT_MAIN_BYPASS_POLICY.md`), landed on `main` with no pre-authorized emergency-exception record. It is a genuine process violation, not a hypothetical.
- Not `High`/`Critical`: the content pushed was truthful (the runtime evidence it added was real — see Impact below), no production system, customer-facing behavior, or live data was touched or put at risk, and the commit did not introduce any code, schema, or runtime change — it only added narrative/evidence fields to two already-existing proof files. There was no data loss, no outage, and no false evidence.
- Raised above a routine `Low` bookkeeping slip specifically because this is a **recurrence** of the identical control-failure pattern (see Root Cause) with no durable record created after the first occurrence — the repeat, plus the absence of a prior log entry, is itself an institutional-learning failure worth a `Medium` severity marker rather than a one-line note.

## Timeline

All times UTC, drawn directly from `git log`, `gh api repos/griff843/Unit-Talk-v2/commits/<sha>`, and `gh run view <id> --log` against `origin/main` (exact commands and findings below; nothing in this timeline is inferred or assumed from the task brief that preceded this investigation).

- `2026-07-14T22:58:29Z` — PR #1216 ("raise concurrency ceiling to 10 active lanes with mechanical type caps") merged to `main` via `pnpm ops:merge-wrapper pr-merge` (squash, auto-merge armed, **no** `--admin`), producing merge commit `8ca5acf38a31fc1492961a0951a6af10029bc6c0`. This merge itself was fully compliant — normal PR path, no bypass. At this point `docs/06_status/proof/UTV2-1533/evidence.json` still had `"status": "PRE-MERGE..."` and `sha_binding.merge_sha: null` — the runtime-proof fields (`verifier`, `runtime_proof`) were not yet present.
- `2026-07-14T22:58:32Z` — `.github/workflows/post-merge-lane-close.yml` run `29374701799` fired on the `push` event for `8ca5acf3`. It ran `pnpm ops:lane-close UTV2-1533 --repair-merged --explain`, which failed closed with exit code 1. The failing checks, verbatim from the run log:
  ```
  [FAIL] C6 runtime-proof closeout requires live/runtime evidence, not narrative-only proof
  [FAIL] P7 evidence bundle must include populated static_proof and runtime_proof sections
  [FAIL] P9 runtime_proof must reference live DB queries, row counts, or receipts
  [FAIL] P10 verifier.identity must be set and not equal to manifest.created_by
  [FAIL] R1 runtime_proof.queries must be non-empty: run pnpm test:db and include live query evidence
  [FAIL] R2 runtime_proof.row_counts must be non-empty: include monitored-table row counts from pnpm test:db
  [FAIL] R3 evidence bundle verifier.identity must be set for T1 phase-boundary-guard
  ```
  The workflow then posted a comment on PR #1216: *"Lane closure blocked — `ops:lane-close --repair-merged` returned exit code 1 for UTV2-1533. Resolve the failing checks and re-run the workflow manually or push a new commit."* This gate behaved exactly as designed: it correctly refused to close a T1 lane without live runtime evidence, and it failed closed rather than silently passing.
- `2026-07-14T23:06:46Z` — commit `74eb6cd65da829cb969a4a7819494a1d3747ccb2` authored and pushed **directly to `origin/main`**, single parent `8ca5acf3` (i.e. a plain linear commit, not a merge commit). Author/committer: `griff843` (human GitHub identity, not `github-actions[bot]` or any other automation identity). `gh api repos/griff843/Unit-Talk-v2/commits/74eb6cd6.../pulls` returns `[]` — **no PR is associated with this commit**. The commit adds `verifier` and `runtime_proof` sections to `docs/06_status/proof/UTV2-1533/evidence.json` and rewrites the `MERGE_SHA:`/"Merge SHA reference" lines in `verification.md`, binding both to the real merge SHA `8ca5acf3...`. The runtime evidence added (`pnpm test:db`, 7/7 pass, live queries and row counts against the `zfzdnfwdarxucxtaojxm` Supabase project) was genuine — this was not fabricated evidence, only evidence added through an unauthorized channel.
- `2026-07-14T23:06:58Z` — `post-merge-lane-close.yml` run `29375141462` fired on the `push` event for `74eb6cd6`, now finding the required runtime evidence present, and `pnpm ops:lane-close UTV2-1533 --repair-merged` **passed** (all M1–M7, L1–L5, G1–G4, P1–P10, C1–C7, R1–R3 checks green).
- `2026-07-14T23:07:29Z` — the same workflow, using its already-documented, explicitly-permitted `SYNC_BOT_TOKEN` bot mechanism (see Root Cause below), committed and pushed `761752f0143d5dc1d9a53f249ad9f24c48a4ef16` ("chore(lanes): close UTV2-1533 — lane closed, sync file removed") directly to `main` as `github-actions[bot]`. This step is the pre-existing, ratified, narrowly-scoped automation path and is **not** part of this incident — it is included in the timeline only for completeness.
- No emergency-exception record (per `DIRECT_MAIN_BYPASS_POLICY.md`'s required pre-bypass fields: incident/issue ID, exact files/commands, why the PR path was too slow, rollback plan, authorizer) was recorded anywhere — not in the incident issue, not in a PR, not in the commit message, not in Linear — before or after commit `74eb6cd6`. This was confirmed by inspecting `docs/06_status/INCIDENTS/` (only one prior, unrelated entry existed at the time) and by reviewing the commit message itself, which explains *what* was done and *why the gate required it*, but records no emergency justification, no rollback plan, and no authorizing party. This was ordinary proof-binding bookkeeping performed under time pressure from a failing gate, not a documented production emergency.

## Detection Path

This incident was surfaced by direct operator instruction to independently verify a governance claim (this lane's own task brief), not by an automated detector — **at the time of the push, no mechanical detector existed in this repo to flag an unauthorized direct-main commit.** Verification was performed via:

- `git log --oneline 8ca5acf3^..761752f0` on `origin/main` (worktree checkout) — confirmed the exact 3-commit sequence and each commit's single-parent shape.
- `git cat-file -p 74eb6cd6` / `git log -1 --format='%H %P' 74eb6cd6` — confirmed a single parent (`8ca5acf3`), i.e. a plain commit, not a 2-parent merge commit.
- `gh api repos/griff843/Unit-Talk-v2/commits/74eb6cd65da829cb969a4a7819494a1d3747ccb2/pulls` — returned `[]`, confirming no associated PR.
- `gh api repos/griff843/Unit-Talk-v2/commits/74eb6cd65da829cb969a4a7819494a1d3747ccb2` — confirmed author/committer `griff843` (human), `verification.verified: false, reason: "unsigned"`.
- `gh run list --branch main --workflow post-merge-lane-close.yml --limit 15 --json ...` and `gh run view <id> --log` for runs `29374701799` (failed on `8ca5acf3`) and `29375141462` (passed on `74eb6cd6`) — confirmed the exact failing check IDs and the exact remediation text the workflow posted.
- `gh api repos/griff843/Unit-Talk-v2/branches/main/protection` — confirmed the mechanical reason branch protection did not block this push (see Root Cause).
- This lane's Half 2 work adds a real mechanical detector (`scripts/ci/direct-main-push-guard.ts`) so future occurrences of this exact pattern are flagged without requiring a manual audit like this one.

## Impact

- **Blast radius: none to production, runtime, or live data.** The pushed diff touched only `docs/06_status/proof/UTV2-1533/evidence.json` and `docs/06_status/proof/UTV2-1533/verification.md` — proof/narrative documents, not application code, migrations, or configuration that affects running systems.
- **Content truthfulness: not in question.** The `pnpm test:db` run referenced (7/7 pass, live queries/row counts against the real `zfzdnfwdarxucxtaojxm` project) was a genuine run, not fabricated. This incident is about *how* the evidence was landed, not whether the evidence itself was honest.
- **Governance-control impact: real.** The requirement to route through a PR, required status checks, and the normal T1 Proof Gate / Runtime Verifier Gate / Merge Gate CI checks before touching `main` was bypassed entirely for this commit. The auto-close that followed (`761752f0`) then treated the lane as legitimately closed based on evidence that itself never went through the CI checks every other PR's proof content is subject to.
- **Recurrence signal:** this is the second known instance of a direct-main bypass of the same policy in four days (see Root Cause), which is itself an impact — it indicates the control gap is systemic rather than a one-off lapse.

## Root Cause

**Immediate cause:** `pnpm ops:lane-close UTV2-1533 --repair-merged`, run automatically by `post-merge-lane-close.yml` on the `push` event, correctly fail-closed post-merge because PR #1216 merged with `docs/06_status/proof/UTV2-1533/evidence.json` missing the `verifier`/`runtime_proof` sections that `scripts/ops/truth-check-lib.ts`'s `runtime_proof_required` gate requires unconditionally for `tier === 'T1'` (checks C6, P7, P9, P10, R1, R2, R3). This part of the system behaved correctly — it is a fail-closed gate, and it did not silently pass.

**Contributing cause 1 — no governed low-friction repair path existed.** The only existing automated mechanism that writes directly to `main` (`ops:proof-generate --merge-sha`, invoked by this same workflow using the `SYNC_BOT_TOKEN` PAT, an already-documented and narrowly-scoped bot exception — see the workflow's own header comments) can only rebind an already-known, externally-immutable merge SHA into existing proof files (`rebindEvidenceJsonSha`/`rebindVerificationMdSha` in `scripts/ops/proof-generate.ts`, both additive/patch-only on the `sha_binding` key). It has no capability to add `runtime_proof`/`verifier` evidence — a categorically different, evidentiary (not merely referential) class of claim. When that gate failed, the workflow's own remediation text ("...re-run the workflow manually or push a new commit") did not name a governed path for adding the missing evidence, and no script existed to scaffold one. Faced with a failing gate and no scripted alternative, a human operator (not the bot identity) edited the proof files directly and pushed to `main`.

**Contributing cause 2 — branch protection does not block admin pushes.** Verified via `gh api repos/griff843/Unit-Talk-v2/branches/main/protection`: `required_status_checks` names `verify`, `Executor Result Validation`, `Merge Gate`, `P0 Protocol` as required contexts, and `required_pull_request_reviews.required_approving_review_count` is `0` — but critically, **`enforce_admins.enabled` is `false`**. GitHub's branch protection structurally exempts repository admins/owners from all of the above when `enforce_admins` is off. `griff843` (the commit's author) is the repository owner, so this push was never actually "blocked-then-bypassed" — GitHub's own protection config simply does not apply to that identity at all for direct pushes. This is stated here as a verified fact, not an inference: the branch-protection API call above succeeded and returned this exact configuration. **What I cannot verify from repo-visible data alone:** GitHub's private audit log entry for this specific push (e.g., whether any UI/CLI "bypass" affordance was explicitly invoked versus the push simply succeeding because no rule applied to that identity) — I did not have a signal to distinguish those, and I am not asserting one.

**Contributing cause 3 — this is an unlogged recurrence.** The identical pattern (a direct commit to `main` editing lane/proof bookkeeping to make a lane appear closed, with no emergency-exception record) occurred previously on 2026-07-10 as part of what later became UTV2-1519 ("revert direct-main park bypass"), confirmed via `gh pr view 1185` (title: "UTV2-1519: revert direct-main park bypass (step 1/2)"; body explicitly states: *"That direct push matched the exact prohibited pattern in docs/05_operations/DIRECT_MAIN_BYPASS_POLICY.md ... without recording an emergency-exception record. This was ordinary bookkeeping, not an emergency; no retroactive exception is being recorded (PM decision)."*). That incident was remediated (revert PR #1185 + re-land PR #1186) but **was never logged in `docs/06_status/INCIDENTS/`** — the only pre-existing entry in the index is the unrelated `INC-2026-04-10-utv2-519`. Without a durable, discoverable incident record from the first occurrence, there was no artifact for this operator (or any future operator) to find and be reminded of before repeating the same pattern four days later.

## Policy / Control Failure

`docs/05_operations/DIRECT_MAIN_BYPASS_POLICY.md` (ratified, Active, UTV2-1432) already prohibits exactly this: *"Editing protected operational truth files on main to make a lane appear closed"* is explicitly listed under Prohibited Bypasses. The policy itself is sound and was not ambiguous. What failed was enforcement and tooling around it:

1. **No mechanical detector** existed to notice, after the fact, that a commit on `main` had no associated PR and no documented emergency exception. The policy lived only in prose with no CI or script checking compliance against real git/GitHub history — a violation of this repo's own invariant #11 ("If a rule can be enforced mechanically, it must not live only in prose"). This lane's Half 2 work (`scripts/ci/direct-main-push-guard.ts`) closes that specific gap.
2. **No incident log entry** was created for the July 10 precedent (UTV2-1519), so the corrective memory that should have existed after the first occurrence did not exist in a place a future operator would consult before making the same choice again.
3. **No governed repair-path script** existed for the single most common trigger of this exact bypass shape: a T1 lane merging without runtime proof and the workflow's own remediation message not steering the operator toward "open a small PR" as the objectively-easier next step. This lane's Half 2 work (`scripts/ops/proof-repair.ts` + an updated remediation message in `post-merge-lane-close.yml`) closes that gap.
4. **Branch protection configuration (`enforce_admins: false`) was not itself examined as a contributing factor** until this incident's investigation. This record surfaces it; changing that GitHub-side setting is an account/repo-configuration action for the repository owner, outside the scope of a code lane, and is called out under Prevention / Lessons below rather than changed unilaterally by this PR.

## Remediation

Implemented in this lane (UTV2-1537) — see this record's Fix PR field once opened:

- `scripts/ops/proof-repair.ts` — a new, additive-only, governed repair mechanism for adding missing T1 runtime evidence (`verifier`/`runtime_proof`) to an already-merged lane's proof bundle, designed to be run on a fresh branch and landed through a normal PR — never to write to `main` directly. It refuses to run without a real, previously-captured `pnpm test:db` result file; it refuses to overwrite an `sha_binding.merge_sha` that is already correctly set; it only merges in the specific missing keys, leaving all hand-authored narrative sections byte-identical.
- `post-merge-lane-close.yml`'s failure-comment step now names this governed path explicitly instead of the ambiguous "push a new commit" text that this incident's root cause traces back to.
- `scripts/ci/direct-main-push-guard.ts` — a new mechanical detector (see Prevention / Lessons) that classifies a commit on `main` as PR-associated, known-bot-automation, documented-emergency-exception, or unauthorized, using only repo/GitHub-API-visible signals.
- This incident record itself and its `README.md` index entry, both durable artifacts this repo's own append-only incident log process was missing for the July 10 precedent.

Call-out: **data cleanup is n/a** — no data was written or corrupted; **`main`'s history was deliberately not rewritten/reverted** for commit `74eb6cd6` — the content it added was true, and reverting would have undone the legitimate lane auto-close that followed it (confirmed `docs/06_status/lanes/UTV2-1533.json` on `main` still correctly shows `"status": "done"` with a passing `truth_check_history` entry bound to the real merge SHA `8ca5acf3...`); the corrective action here is procedural (build the missing governed path + detector) rather than a history rewrite.

## Follow-Up Issues

| Linear | Title | Status |
|---|---|---|
| `UTV2-1537` | This incident's own tracking/fix lane (governance-control repair + incident record) | In Progress |

## Prevention / Lessons / New Controls

- **Mechanical detector added** (`scripts/ci/direct-main-push-guard.ts`, this lane): classifies commits on `main` from repo/GitHub-API-visible signals only. Its honest capability boundary — stated plainly rather than oversold — is documented in its own module header and in this lane's verification notes: it can reliably tell (a) whether a commit has an associated merged PR via `gh api commits/{sha}/pulls`, (b) whether the committer identity matches a known, allow-listed automation identity/commit-message pattern, and (c) whether a same-day incident doc references the SHA with the policy's required emergency-exception fields. It **cannot** verify GitHub's private audit log, cannot distinguish "an admin push succeeded because no rule applied" from "an admin explicitly invoked a bypass affordance," and cannot itself change branch-protection configuration.
- **Governed repair path added** (`scripts/ops/proof-repair.ts`, this lane): closes the specific "no low-friction alternative to direct-main-edit" gap that this incident's contributing-cause-1 identifies. Never writes to `main`; produces a diff meant for a small, normal PR.
- **Recommend (not applied by this PR — outside a code lane's authority):** the repository owner should evaluate enabling `enforce_admins` on `main`'s branch protection, or accept in writing that admin-identity direct pushes are an intentionally-retained emergency valve and ensure `DIRECT_MAIN_BYPASS_POLICY.md`'s emergency-exception record is the actual, exercised discipline for that valve going forward, since GitHub itself does not enforce it structurally for that identity.
- **Recommend:** every future direct-main-bypass discovery gets a `docs/06_status/INCIDENTS/` entry immediately, even when (like UTV2-1519) it is remediated same-day and feels "closed" — the absence of that entry for UTV2-1519 is a plausible contributing factor in this incident's recurrence, and is the specific gap this record itself corrects for the log going forward.

## Linked Evidence / Proof Bundles

- `docs/06_status/proof/UTV2-1533/evidence.json` on `main` — the proof bundle this incident is about; also the reference field-naming convention (`sha_binding.merge_sha`, `sha_binding.verified_source_sha`, `sha_binding.proof_bundle_base_sha`) this lane's `proof-repair.ts` reuses.
- `docs/06_status/lanes/UTV2-1533.json` on `main` — confirms `status: "done"` and a passing `truth_check_history` entry bound to `8ca5acf3...`, supporting the "not reverted" decision above.
- `gh run view 29374701799 --log` — the failed `post-merge-lane-close.yml` run showing the exact C6/P7/P9/P10/R1/R2/R3 failures.
- `gh run view 29375141462 --log` — the subsequent passing run after the direct push.
- `gh api repos/griff843/Unit-Talk-v2/branches/main/protection` — the branch protection configuration cited under Root Cause.
- `gh pr view 1185` — the UTV2-1519 precedent's revert PR body, cited under Root Cause / Contributing cause 3.
- This lane's own proof bundle: `docs/06_status/proof/UTV2-1537/evidence.json`, `docs/06_status/proof/UTV2-1537/verification.md`.
