# PROOF: UTV2-1705

MERGE_SHA: 54412f88145385d8362362ea81977445263b543d

Pre-merge, this anchor is the verified implementation commit. Post-merge closeout automation rebinds proof artifacts to the authoritative merge SHA.

## ASSERTIONS:

- [x] The canonical lane PR binder accepts both Codex and Claude lane executors.
- [x] Pull-request `opened` and `reopened` events bind the PR URL without a manual metadata repair.
- [x] Privileged event handling executes trusted base-ref code only, validates the declared PR base, and retries non-fast-forward persistence without force-pushing.
- [x] Rebinding the same URL is idempotent, while a different URL fails closed.
- [x] A bound manifest supplies `lane-finalize` with its PR identity when no explicit PR argument is provided.
- [x] Finalization is serialized under the merge mutex and an orphan-recoverable journal lock, preserves freshly observed Linear labels, and always reruns current-state reconciliation.

## EVIDENCE:

```text
Focused tests: 36 passed, 0 failed
Static verification: PASS, including 2,188 root tests
R-level compliance: PASS, no matching rules
Staging writable DB proof: delegated to staging-ci as required for T1
Live Linear integration: tier:T1 applied and verified; immediate replay was an idempotent no-op
```

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm verify:static` | PASS | DB-client boundary, sync, system-alignment, automation-coverage, environment, lint, `pnpm type-check`, build, `pnpm test`, Smart Form verification, and command verification completed with exit 0; 2,188 root tests passed. |
| `pnpm exec tsx --test scripts/ops/lane-finalize.test.ts scripts/ops/lane-link-pr.test.ts` | PASS | 36 tests passed, 0 failed. |
| `pnpm test:db` | BLOCKED / DEFERRED | The staging-isolation guard refused before DB execution: local target `host=127.0.0.1 ref=unidentified`; writable DB verification requires `xskgrzbteyqdufktjrjx` through the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials. Packet disposition: writable live-DB proof is blocked/deferred because target identity could not be resolved from its URL (`host=unparseable`). |
| Linear tier-label integration | PASS | First live invocation returned `linear_tier_label_applied`, `changed: true`, and labels `["tier:T1"]`; immediate replay returned `linear_tier_label_already_applied` with `changed: false`. |
| Positional closeout dry-run | PASS | `pnpm ops:lane-finalize -- UTV2-1705 --dry-run --json` resolved PR `1420` from `manifest.pr_url` and planned the complete closeout without writes. |
| Partial-finalize recovery | PASS | Regression coverage serializes journal mutation under the merge mutex, rejects concurrent retries, reclaims a dead local journal owner, resumes completed steps, and reruns reconciliation even when a prior journal recorded it. |
| Privileged workflow boundary | PASS | Static workflow regression requires `pull_request_target`, a checkout pinned to `base.sha`, `--ignore-scripts`, an explicit `--base` argument, and bounded fetch/rebase retry; event regressions reject missing or mismatched PR bases. |
| Linear label race | PASS | The writer refreshes issue labels immediately before its replace-style mutation; the regression injects a concurrently added non-tier label and proves it remains in `labelIds`. |
| Executor-gate mutation | PASS | Temporarily restoring `isCodexLane` made 3 regressions fail, including `lane-link-pr binds a Claude lane and resolves its issue from the branch name`; restored suite passed. |
| Workflow-invocation mutation | PASS | Temporarily replacing the `ops:lane-link-pr` workflow command made exactly the workflow-wiring regression fail; restored suite passed. |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS | Changed files: 11; no R-level rules matched and no R-level artifacts were required. |

### Acceptance coverage

- Claude manifests bind successfully through the same canonical writer.
- PR `opened` and `reopened` events invoke binding automatically from the branch and PR event identities.
- Bound manifest truth feeds `lane-finalize` without an explicit/manual PR metadata repair.
- Positional issue syntax survives pnpm's forwarded `--` separator.
- The Linear label consumed by truth-check L2 is applied idempotently and verified from the mutation response.
- A partial finalize is durably visible, serialized across concurrent retries, and safely resumes without replaying completed one-shot steps.
- Reconciliation is repeatable on every invocation, and fresh Linear label truth prevents unrelated concurrent labels from being dropped.
- Rebinding the same URL is a no-op; a different URL remains `pr_url_mismatch` and fails closed.
- Both executor neutrality and automatic invocation were proven by mutation.
- Event-driven binding is executable without an ephemeral preflight token, restricted to GitHub PR event contexts, and validates the manifest-declared base before mutation.
- Privileged workflow execution comes from the trusted base SHA; lane-head contents are treated only as data and are never installed or executed.

### Runtime proof disposition

This lane changes repository lifecycle tooling and workflow automation, not application or database runtime behavior. Nevertheless, T1 requires writable DB proof. The local guard correctly prevented a non-staging run. The authoritative DB job remains required in PR CI and must run against Supabase project `xskgrzbteyqdufktjrjx`.

### Scope

Only the canonical PR binder/finalizer, their regression tests, the PR-open workflow, sync metadata, and UTV2-1705 proof artifacts changed. No Tier C source path from `AGENTS.md`, runtime package, migration, contract, or generated DB type was modified.
