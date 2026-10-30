# PROOF: WORK-2026102903

MERGE_SHA: pending merge

Issue: WORK-2026102903
Tier: T1
Lane type: governance
result: local_static_pass_staging_deferred

## ASSERTIONS:

- [x] The workflow's "Resolve lane from branch" step, executed with bash exactly as written in `.github/workflows/lane-pr-binding.yml`, yields `bind=true` / `issue_id=WORK-2026102903` for `claude/work-2026102903-work-lane-pr-binding` with a matching manifest, still yields `bind=true` / `issue_id=UTV2-1977` for a UTV2 lane, and yields `bind=false` for a branch with no work identifier, a missing manifest, and a manifest registered to a different branch (`lane-link-pr.test.ts`, "lane PR binding resolves WORK-### lanes as well as UTV2-### lanes from the branch").
- [x] The binder step passes the resolved id as `--issue "$ISSUE_ID"` from `steps.lane.outputs.issue_id` ("the binding workflow hands the resolved issue id to the trusted binder").
- [x] `lane-link-pr.ts --issue WORK-99990001 ... --github-event` binds the lane: `lane_linked`, status `in_review`, `pr_url` written to the manifest ("GitHub event binding links a WORK-### lane named by --issue").
- [x] Without `--issue`, the trusted binder cannot resolve a WORK branch on its own (`Invalid issue id`, below), so both changes are required.
- [x] Unchanged: permissions, triggers, checkout refs, the trusted/lane checkout split, the persist and retry step, `issueIdFromBranchName` (shared with open-PR lock discovery), merge gate, ERV and P0 Protocol.

## EVIDENCE:

Why: 6 of the last 21 failed `post-merge-lane-close.yml` runs (2026-10-18 to 2026-10-28) ended `Cannot resolve authoritative merge SHA: manifest.pr_url is missing or invalid ()`: runs 40452502572, 40452104754, 40427174465, 40421243679, 39193806175 and 39192328748 (classified from each run's log). Each left a merged branch with an active lane, which `MERGED_PR_ACTIVE_LANE` (`scripts/ops/merge-risk.ts`) turns into a hard fail for every lane-start.

Mutation checks (each change reverted alone, test rerun, file restored):

```text
M1 branch match back to 'utv2-[0-9]+'   -> "resolves WORK-### lanes" test: pass 0, fail 1
M2 --issue "$ISSUE_ID" line removed     -> "hands the resolved issue id" test: pass 0, fail 1
```

Binder without `--issue` on a WORK branch:

```text
pnpm -s exec tsx scripts/ops/lane-link-pr.ts --branch claude/work-99990002-event-binding --base main --pr https://github.com/example/unit-talk/pull/135 --github-event
{ "ok": false, "code": "lane_link_pr_failed", "message": "Invalid issue id: ", ... }
exit=1
```

## Verification

Run on `7b3ef56d0dc6d8b6409b9c7bb72d819d241fb991`. The execution SHA `42c212cee5dfe9daaff19bf9cbc7aa4385eef7f3` differs from it only in one sentence of `.ops/work/WORK-2026102903.md` (a count, 7 corrected to 6), which no test reads, so the suite was not rerun:

- [x] `pnpm exec tsx --test scripts/ops/lane-link-pr.test.ts`: `# tests 26`, `# pass 26`, `# fail 0`.
- [x] `pnpm exec tsx --test scripts/ops/lane-close.test.ts`: `# tests 194`, `# pass 194`, `# fail 0` (asserts the workflow's resolve and binder steps).
- [x] `pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts`: `# tests 94`, `# pass 94`, `# fail 0`.
- [x] `pnpm exec tsx --test scripts/ci/workflow-production-credential-guard.test.ts`: `# tests 37`, `# pass 37`, `# fail 0`.
- [x] `pnpm type-check`: exit 0.
- [x] `pnpm test`: exit 0; summed node:test totals across all files `# tests 7677`, `# pass 7664`, `# fail 0`, `# skipped 13`.
- [x] `pnpm exec eslint scripts/ops/lane-link-pr.test.ts`: exit 0. Repo-wide `pnpm lint` runs in CI.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: `Verdict: PASS`, no R-level artifacts required.
- [x] `pnpm ops:preflight WORK-2026102903 --tier T1 ... --refresh`: `VERDICT: PASS (42 checks)`.
- [ ] `pnpm verify` in CI on the PR head: pending; CI `verify` is the verification of record.
- [ ] `pnpm test:db`: deferred to the protected `staging-ci` environment inside the required `verify` check. No database was accessed by this lane.

Runtime: `pull_request_target` runs the workflow from the default branch, so this PR's own binding still runs the old code. The change is observable on the first WORK-### PR opened after merge (its manifest gains `pr_url` and `in_review` from a `chore(lanes): bind WORK-... to PR` bot commit). This PR's manifest is bound by hand, as before.

Lane start used `--singleton-approved` (`.github/workflows/**` is singleton-only) as the orchestrator confirmation; no other active lane held a `.github/` path at lane start.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1802
Execution SHA: 42c212cee5dfe9daaff19bf9cbc7aa4385eef7f3
