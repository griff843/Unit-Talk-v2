# PROOF: UTV2-1705

MERGE_SHA: aa5cac276b57914ecc0bca31df00fd2b2aba0caa

Pre-merge, this anchor is the verified implementation commit. Post-merge closeout automation rebinds proof artifacts to the authoritative merge SHA.

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm verify:static` | PASS | `pnpm lint`, `pnpm type-check`, build, `pnpm test`, Smart Form verification, and command verification completed with exit 0; aggregate test segment: 2,175 passed, 0 failed. |
| `pnpm exec tsx --test scripts/ops/lane-finalize.test.ts scripts/ops/lane-link-pr.test.ts` | PASS | 23 tests passed, 0 failed after both mutations were restored. |
| `pnpm test:db` | BLOCKED / DEFERRED | The staging-isolation guard refused before DB execution: local target `host=127.0.0.1 ref=unidentified`; writable DB verification requires `xskgrzbteyqdufktjrjx` through the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials. Packet disposition: writable live-DB proof is blocked/deferred because target identity could not be resolved from its URL (`host=unparseable`). |
| Executor-gate mutation | PASS | Temporarily restoring `isCodexLane` made 3 regressions fail, including `lane-link-pr binds a Claude lane and resolves its issue from the branch name`; restored suite passed 23/23. |
| Workflow-invocation mutation | PASS | Temporarily replacing the `ops:lane-link-pr` workflow command made exactly the workflow-wiring regression fail; restored suite passed 23/23. |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS | Changed files: 10; no R-level rules matched and no R-level artifacts were required. |

### Acceptance coverage

- Claude manifests bind successfully through the same canonical writer.
- PR `opened` and `reopened` events invoke binding automatically from the branch and PR event identities.
- Bound manifest truth feeds `lane-finalize` without an explicit/manual PR metadata repair.
- Rebinding the same URL is a no-op; a different URL remains `pr_url_mismatch` and fails closed.
- Both executor neutrality and automatic invocation were proven by mutation.
- Event-driven binding is executable in a test without an ephemeral preflight token and is restricted in code to a `pull_request` GitHub Actions context.

### Runtime proof disposition

This lane changes repository lifecycle tooling and workflow automation, not application or database runtime behavior. Nevertheless, T1 requires writable DB proof. The local guard correctly prevented a non-staging run. The authoritative DB job remains required in PR CI and must run against Supabase project `xskgrzbteyqdufktjrjx`.

### Scope

Only the canonical PR binder, its regression tests, the PR-open workflow, sync metadata, and UTV2-1705 proof artifacts changed. No Tier C source path from `AGENTS.md`, runtime package, migration, contract, or generated DB type was modified.
