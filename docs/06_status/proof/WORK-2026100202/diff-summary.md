# Diff summary: WORK-2026100202

Bounded T1 CI-policy fix, with execution approval only. No product/runtime behavior or
branding geometry changed. The PM-requested correction moves only the sidebar lockup into
UnitTalkLogo.tsx; WorkspaceSidebar.tsx is never eligible for lightweight CI. Merge approval remains pending human review.

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | Complete fail-closed brand-only classification, conditional producer/receipt enforcement, static app/component gates |
| `AGENTS.md` | Narrow static-brand verification exception; T1 and sensitive-path rules retained |
| `CLAUDE.md` | Same verification boundary and unchanged merge authority |
| `docs/05_operations/R1_R5_OPERATING_RULE.md` | No R1-R5/live runtime proof for positively classified static branding; UI QA retained |
| `docs/05_operations/LIVE_DB_VERIFY_ISOLATION_BRANCH_PROTECTION.md` | Exact allowlist, both CI paths, fail-closed states, unchanged protection contexts |
| `apps/command-center/src/components/UnitTalkLogo.tsx` | Dedicated pure branding renderer; exact canonical paths and layout preserved |
| `apps/command-center/src/components/WorkspaceSidebar.tsx` | Import extracted lockup only; auth/nav/health/handlers unchanged and excluded from the fast path |
| `scripts/ci/staging-path-enforcement.test.ts` | Directly register classifier/synthetic-diff and isolated component regressions in the script-wired test entrypoint; retain staging guards |
| `.ops/work/WORK-2026100202.md` | Work order and explicit execution-only T1 approval |
| `.ops/sync/WORK-2026100202.yml` | Lane-generated immutable task contract |
| `docs/06_status/lanes/WORK-2026100202.json` | Lane-generated exact scope and deferred-to-CI live precondition |
| `docs/06_status/proof/WORK-2026100202/{diff-summary.md,verification.md,evidence.json,model-routing.json}` | Review/proof packet; no fabricated runtime or merge evidence |

## Scope check

The retired local-only WORK-2026100201 bootstrap work order is excluded from this branch's
net PR diff. All net changes relative to origin/main belong to this scope and this lane.
Only the focused branding extraction touches app implementation; no contracts/domain/DB,
migrations, API, worker, or delivery files changed. No package/lockfile changes or unrelated cleanup.

## Regression proof

- Synthetic committed pure UnitTalkLogo edit under T2/T3: `brand_only=true`.
- Same comparison plus a real sidebar sign-out method edit under T2/T3: `brand_only=false`.
- Sidebar-only edits under T2/T3: `brand_only=false`.
- Both pure component sources reject hooks/imports/effects/interactive elements/handlers.
- Before/after extraction: 24/24 sidebar SSR HTML comparisons identical.
- Synthetic committed brand + ordinary metadata diff: `brand_only=true`, lightweight path.
- Same comparison plus `apps/api/src/submission-service.ts`: `brand_only=false`, normal path.
- T1, proof-required, unknown/ambiguous tier, missing range, moved HEAD, and extra sensitive
  paths retain normal proof. Failed/skipped/cancelled normal producers fail required verify.

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1711
