# Live-DB Verify Isolation — Implementation & Branch-Protection Recommendation (UTV2-1292)

Implements the approved proposal `docs/05_operations/LIVE_DB_VERIFY_ISOLATION_PROPOSAL.md` (UTV2-1291).
Goal: a transient Supabase write-path degradation must not block unrelated docs-only / T3 lanes or
amplify live-DB load, **while T1 runtime proof stays strict**.

## Current CI policy: static branding exception (WORK-2026100202)

The current `ci.yml` normally requires the serialized, staging-bound `staging-db-proof` producer
and validates its same-run receipt inside the required `verify` context. The historical verdict
table and follow-up recommendations below describe UTV2-1292, not a bypass of that current gate.

A fail-closed classifier now permits one narrow, non-T1 presentation-only exception. A complete,
nonempty diff must contain at least one brand path, and every changed path must be one of:

- `docs/03_product/brand/**`
- `apps/smart-form/app/submit/components/BrandLogo.tsx`
- `apps/command-center/src/components/WorkspaceSidebar.tsx`
- `docs/06_status/lanes/{WORK|UTV2}-<digits>.json`
- `docs/06_status/proof/{WORK|UTV2}-<digits>/**` with `.md`, `.json`, or `.png` artifacts only
- `.ops/sync/{WORK|UTV2}-<digits>.yml` or `.ops/work/WORK-<digits>.md`

The PR must have exactly one known `tier:T2` or `tier:T3` label and no `proof-required` label.
Main pushes use the unique merged PR associated with that exact commit to resolve its tier;
unknown/ambiguous association falls back to normal CI. PR comparisons use the full git
merge-base diff, pushes use the full before/after diff, and rename detection is disabled so
both old and new paths are checked. API pagination cannot truncate the changed-file set.
Failed checkout/classification, missing or ambiguous output, missing tier, T1, and any extra
runtime/product/data/backend/configuration file cannot silently opt out.

For this class, required `verify` runs `pnpm verify:static`, Smart Form and Command Center
build/type-check, and `scripts/ci/branding-components.test.ts`: real React SSR in an isolated
harness checks exact canonical SVG paths, accessible identity, expanded/collapsed rendering,
and PNG/icon signatures without routing/services/DB access. There is **no writable staging DB
proof and no runtime proof requirement**, and no mandatory R1-R5. Operator-UI QA artifacts and
normal review/merge requirements remain applicable.

`verify` still runs with `if: always()`. Only successful positive classification together with
a **skipped** producer is accepted on the branding path. Normal CI requires a **successful**
producer and the unchanged same-run receipt download/verification. A failed/cancelled/missing
producer or classifier is red, not a silently skipped required check. The producer alone holds
staging credentials and honors workflow cancellation rather than continuing a superseded run;
required `verify` still rejects canceled normal proof. Classification and static verification hold
none. Branch-protection context
names are unchanged, and no GitHub settings change is required.

T1, runtime, DB, migration, API-service, and delivery verification are unchanged. This CI-policy
implementation lane itself is T1 and follows normal staging proof; it is not brand-only.
Focused regression proof executes the workflow's classifier over synthetic brand-only and
brand-plus-API-service git diffs and tests failed/missing producer and classification states.

## What this lane changed (in-repo, no GitHub settings touched)

1. **`package.json` script split**
   - `test:t1-proof:local` — the 7 proof-named tests that need **no** live DB (authority matrix, dual-auth, approval-expiration, governance-rollback, dual-auth-expiry-boundary, cross-domain-enforcement, terminal-rollback-states). Verified to contain no `createClient` / repository / live-Supabase usage.
   - `test:t1-proof:live` — the 13 live Supabase proof suites (awaiting-approval, atomicity, lifecycle-invariants, risk-score, stranded-picks, raw-payload-archive, artifact-sha, picks-fsm, execution-intent, settlement-immutability, settlement-corrections, bounded-dedup, awaiting-approval-review).
   - `test:t1-proof` = local + live (unchanged full behavior for direct callers).
   - Root **`test` is now local-only** (ends with `test:t1-proof:local`).
   - `test:live-db` = `pnpm test:db && pnpm test:t1-proof:live`.
   - `verify:static` = the previous `verify` body (now static, since `test` is local-only).
   - **`verify` = `verify:static && test:live-db`** (full local-dev gate behavior preserved).

2. **`scripts/ci/live-db-verdict.ts`** — runs `test:live-db`, classifies the outcome into a
   machine-readable verdict (`live-db-verdict/v1`) and exits non-zero **only** on `code_failed`:
   - `passed` — live suite passed.
   - `code_failed` — assertion/type/app defect (no infra signature). **Blocks** (exit 1).
   - `infra_unavailable` — schema-cache / statement-timeout / 520-521 / connection failure. **Not** a code defect (exit 0); the tier policy decides whether it blocks.
   - `proof_skipped` — Supabase credentials absent (exit 0).
   - Pure `classifyLiveDbOutcome` is unit-tested offline (`live-db-verdict.test.ts`, 8/8).

3. **`.github/workflows/ci.yml`** — the CI job's `Verify` step now runs **`pnpm verify:static`**; the
   former `Database smoke test` step is replaced by **`Live DB proof (classified)`** (`pnpm verify:live-db-verdict`),
   which covers `test:db` + the live t1-proof subset and surfaces the verdict in the job summary.

## The four states → CI behavior

| State | Detected by | CI `verify` job | Merge behavior |
|---|---|---|---|
| **code failure** | `verify:static` red, or live verdict `code_failed` | **fails** | Block, fix required (all tiers). |
| **infrastructure unavailable** | live verdict `infra_unavailable` | **passes** (static still gates) | Docs-only/T3 may proceed on static green. **T1 stays blocked** via the separate fail-closed `T1 Proof Gate`. |
| **proof insufficient** | T1 lane with no passing live proof bound to head | `T1 Proof Gate` fails (tier:T1) | Block (T1/runtime). Reported infra-blocked, not code-failed. |
| **merge allowed** | static green + required live proof satisfied/not-required + tier approval | passes | T1 still needs live proof + `t1-approved`; T2 needs `pm-verdict`; T3 on green required checks. |

## T1 strictness — preserved (no weakening)

- `T1 Proof Gate` (separate workflow) is **unchanged** and still runs `ci:db-smoke` fail-closed for
  `tier:T1`. During a Supabase degradation it fails → T1 lanes are blocked as **proof insufficient**.
- **UTV2-1288 still cannot merge** without real `test:db` / live proof (its T1 Proof Gate + `t1-approved`).
- No PM-gate bypass; Merge Gate, Executor Result Validation, Tier Label, File Scope, R-Level all unchanged.

## Branch-protection / required-check recommendation (MANUAL — PM to apply)

The required status context is still the CI job (reported as `verify`). The in-repo change above keeps
that context's name, so **no immediate branch-protection edit is required** for the current behavior.

For the fuller proposal (recommended follow-ups; each is a deliberate, PM-gated step):

1. **Separate, serialized `Live DB Proof` job.** Move `test:live-db` into its own job with a
   repository-level concurrency group (`group: live-db-proof-${{ github.repository }}`,
   `cancel-in-progress: false`) so concurrent PRs don't multiply live write pressure. Then add
   `Live DB Proof` as a **required context only for `tier:T1` / runtime-DB-sensitive path matches**
   (via the existing tier/path gating used by `T1 Proof Gate` / `Proof Coverage Guard`). Keep
   `verify` (static), `Merge Gate`, `Executor Result Validation`, `Tier Label Check`,
   `File Scope Lock Check`, `R-Level Compliance Check` required for all.
2. **T2 runtime-adjacent classification by path.** A T2 lane touching `apps/api/src/**-service.ts`,
   `packages/db/**`, `supabase/migrations/**`, or runtime proof paths should require the live proof or
   a PM-approved deferral; a T2 docs/governance lane follows the docs/T3 policy.
3. **`T1 Proof Gate` consumes the live-DB verdict** (instead of launching a duplicate live run) once the
   separate job exists — avoids double live-write load for T1 PRs.

## Non-goals
- No weakening of T1 runtime gates. No PM-gate bypass. No public Discord. No P3 certification.
- No live backfill. No secrets. No runtime/data/migration behavior change (CI/test-harness only).
