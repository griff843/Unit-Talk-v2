# PROOF: UTV2-1705

MERGE_SHA: a6173d9cdf15426459949d156ee2df359e6fa630

Pre-merge, this anchor is the verified implementation commit. Post-merge closeout automation rebinds proof artifacts to the authoritative merge SHA.

## ASSERTIONS:

- [x] The canonical lane PR binder accepts both Codex and Claude lane executors.
- [x] Pull-request `opened`, `reopened`, and `edited` events bind or revalidate the PR URL without a manual metadata repair.
- [x] Retargeting the exact bound PR away from `manifest.base_branch` clears the binding regardless of current lane status, preserves unrelated blockers while adding `pr-base-mismatch`, and prevents explicit-PR finalization from bypassing the invalidation.
- [x] Canonical-main finalization independently reads the PR's current GitHub base and merged state, so branch-local invalidation cannot be bypassed after a wrong-base merge.
- [x] Privileged event handling executes protected default-branch code only, validates the declared PR base, and retries non-fast-forward persistence without force-pushing.
- [x] Rebinding the same URL is idempotent, while a different URL fails closed.
- [x] A bound manifest supplies `lane-finalize` with its PR identity when no explicit PR argument is provided.
- [x] Finalization refuses PR identity disagreement, atomically serializes merge-mutex acquisition plus its orphan-recoverable journal, invalidates completed journals when a lane reopens, preserves concurrent Linear labels with relation-specific mutations, and always reruns current-state reconciliation.

## EVIDENCE:

```text
Focused tests: 45 passed, 0 failed
Static verification: PASS, including 2,194 root tests
R-level compliance: PASS, no matching rules
Staging writable DB proof: delegated to staging-ci as required for T1
Live Linear integration: tier:T1 applied and verified; immediate replay was an idempotent no-op
```

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm verify:static` | PASS | DB-client boundary, sync, system-alignment, automation-coverage, environment, lint, `pnpm type-check`, build, `pnpm test`, Smart Form verification, and command verification completed with exit 0; 2,194 root tests passed. |
| `pnpm exec tsx --test scripts/ops/lane-finalize.test.ts scripts/ops/lane-link-pr.test.ts` | PASS | 45 tests passed, 0 failed. |
| `pnpm test:db` | BLOCKED / DEFERRED | The staging-isolation guard refused before DB execution: local target `host=127.0.0.1 ref=unidentified`; writable DB verification requires `xskgrzbteyqdufktjrjx` through the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials. Packet disposition: writable live-DB proof is blocked/deferred because target identity could not be resolved from its URL (`host=unparseable`). |
| Linear tier-label integration | PASS | First live invocation returned `linear_tier_label_applied`, `changed: true`, and labels `["tier:T1"]`; the updated relation-specific writer replayed live as `linear_tier_label_already_applied` with `changed: false`. |
| Positional closeout dry-run | PASS | `pnpm ops:lane-finalize -- UTV2-1705 --dry-run --json` resolved PR `1420` from `manifest.pr_url` and planned the complete closeout without writes. |
| Partial-finalize recovery | PASS | Regression coverage atomically serializes cross-issue acquisition before the existing merge mutex, serializes the issue journal, cleans up refused acquisition journals, reclaims a dead local journal owner, resumes completed steps, invalidates a prior completed journal after reopen, and reruns reconciliation even when a prior journal recorded it. |
| Privileged workflow boundary | PASS | Static workflow regression requires `pull_request_target`, protected default-branch checkout, `--ignore-scripts`, an explicit `--base` argument, PR `edited` revalidation, and bounded fetch/rebase retry; event regressions reject missing or mismatched PR bases. |
| Linear label race | PASS | The writer uses `issueAddLabel` and `issueRemoveLabel` rather than replace-style `labelIds`; the regression injects a concurrently added non-tier label and proves it survives unchanged. |
| Executor-gate mutation | PASS | Temporarily restoring `isCodexLane` made 3 regressions fail, including `lane-link-pr binds a Claude lane and resolves its issue from the branch name`; restored suite passed. |
| Workflow-invocation mutation | PASS | Temporarily replacing the `ops:lane-link-pr` workflow command made exactly the workflow-wiring regression fail; restored suite passed. |
| Head-ref identity mutation | PASS | Temporarily removing only the `headRefName` comparison made the isolated wrong-ref regression fail; restored suite passed. |
| Default-branch trust mutation | PASS | Temporarily restoring the privileged checkout to `base.sha` made the workflow boundary regression fail; restored suite passed. |
| Atomic acquisition mutation | PASS | Temporarily bypassing the exclusive cross-lane acquisition guard made the two-issue mutex regression fail; restored suite passed. |
| Linear relation mutation | PASS | Temporarily skipping conflicting-tier removal made the label-specific mutation regression fail; restored suite passed. |
| Retargeted-binding mutation | PASS | Temporarily disabling the `pr-base-mismatch` finalize guard made the production-path retarget regression fail and exposed a successful seven-step wrong-base closeout plan; the restored guard makes the scenario pass. |
| Blocked-lane invalidation mutation | PASS | Temporarily restoring the `status === 'in_review'` predicate made exactly `retargeting invalidates a bound PR while preserving unrelated lane blockers` fail; removing the predicate restored the suite to 45/45. |
| Canonical-base mutation | PASS | Temporarily disabling the canonical GitHub base comparison made both the direct guard and actual CLI-path wrong-base regressions fail; the restored comparison rejects the wrong-base PR before journal reuse or closeout planning. |
| Reopen-generation mutation | PASS | Temporarily reusing a completed journal across a new reopen generation made the regression observe all seven stale completed steps; the restored generation binding starts an empty closeout journal. |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS | Changed files: 11; no R-level rules matched and no R-level artifacts were required. |

### Acceptance coverage

- Claude manifests bind successfully through the same canonical writer.
- PR `opened`, `reopened`, and `edited` events invoke binding or base revalidation automatically from the branch and PR event identities.
- Bound manifest truth feeds `lane-finalize` without an explicit/manual PR metadata repair.
- Positional issue syntax survives pnpm's forwarded `--` separator.
- The Linear label consumed by truth-check L2 is applied idempotently with relation-specific mutations and verified from a fresh read without replacing unrelated labels.
- A partial finalize is durably visible, serialized across different issues and concurrent retries, and safely resumes without replaying completed one-shot steps.
- Reconciliation is repeatable on every invocation, and label-specific Linear writes cannot erase unrelated concurrent labels.
- Rebinding the same URL is a no-op; a different URL remains `pr_url_mismatch` and fails closed.
- Both executor neutrality and automatic invocation were proven by mutation.
- Event-driven binding is executable without an ephemeral preflight token, restricted to GitHub PR event contexts, and validates the manifest-declared base before mutation.
- An edited event that retargets the exact bound PR away from the declared base durably removes `pr_url` regardless of whether the lane is `in_review` or already `blocked`, preserves unrelated `blocked_by` entries, records `pr-base-mismatch`, and rejects a later explicit-PR finalize attempt without writing merge or terminal state.
- Canonical-main finalization queries GitHub directly and refuses a merged PR whose current base differs from `manifest.base_branch`, even when its local manifest never received the branch-local invalidation commit.
- A truth-check reopen changes the finalize generation, so a prior completed journal cannot skip merge recording, proof generation, reconciliation, or lane close.
- Privileged workflow execution comes from the protected repository default branch; both PR head and PR base contents are treated only as data and are never installed or executed.

### Runtime proof disposition

This lane changes repository lifecycle tooling and workflow automation, not application or database runtime behavior. Nevertheless, T1 requires writable DB proof. The local guard correctly prevented a non-staging run. The authoritative DB job remains required in PR CI and must run against Supabase project `xskgrzbteyqdufktjrjx`.

### Scope

Only the canonical PR binder/finalizer, their regression tests, the PR-open workflow, sync metadata, and UTV2-1705 proof artifacts changed. No Tier C source path from `AGENTS.md`, runtime package, migration, contract, or generated DB type was modified.
