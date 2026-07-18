# UTV2-1557 proof

## Verification

| Field | Result |
|---|---|
| Base branch head | `15c78512dea9d2fdd249d1b06ff9fabb6e47dd0f` (origin/main) |
| `pnpm verify` | PASS (`verify:static` + `pnpm test:live-db`, exit code 0) |
| `pnpm ops:sync-check` | PASS — branch/sync file bound |
| `pnpm ops:system-alignment-check` | PASS — fail=0 warn=0 |
| `pnpm ops:automation-coverage-check` | PASS — fail=0 warn=0 classified=15 |
| `pnpm lint` | PASS |
| `pnpm type-check` | PASS |
| `pnpm build` | PASS |
| `pnpm test` | PASS |
| `pnpm test:live-db` (test:db) | PASS across all live-DB suites; 1 unrelated pre-existing skip (stale `provider_offer_history` snapshot outside the 72h lookback window — data-freshness condition, not a code regression) |
| R-level check | Not applicable — docs-only change, no code/schema/workflow paths touched |
| Runtime behavior changed | No — this PR adds three documents under `docs/06_status/` only |
| Merge Gate / deploy workflow changed | No |
| GitHub App / secret changes | No |
| Constitution changed | No |
| Independent owner approval | Not supplied; still required for this T1 PR (`t1-approved` label or `pm-verdict/v1`) |

## Scope

This lane adds three governance planning documents (no source, schema, workflow, or config changes):

* `docs/06_status/T1M_DELEGATION_DESIGN_PACKET.md`
* `docs/06_status/T1M_DELEGATION_CODEX_ADVERSARIAL_REVIEW.md`
* `docs/06_status/T1M_DELEGATION_FINAL_PM_DECISION.md`

The PR does not modify `.github/workflows/**`, `scripts/ops/**`, deploy tooling, or any GitHub App/secret
configuration, and does not activate, implement, or self-authorize any machine merge authority. Every future
PR in the bootstrap chain this packet describes (UTV2-1451 → UTV2-1546 → UTV2-1500 → UTV2-1555) continues to
merge under the existing Griff-only T1 gate.

## Operational note (known exception, not resolved by this PR)

`ops:lane-start` could not run for this lane on first attempt: the `governance` lane-type concurrency cap
defined at `type_caps.governance` in `docs/governance/CONCURRENCY_CONFIG.json` (the canonical key — this
document does not restate its numeric value, since that value is policy-owned by that file and can change
independently of this proof) was exhausted by two stale entries — `UTV2-1501` (PR #1230, merged 2026-07-16)
and `UTV2-1506` (PR #1231, merged 2026-07-17) — whose local lane manifests were never closed after merge
("ghost lanes"). **Observed value at the time of this finding: `type_caps.governance = 3` as of commit
`15c78512dea9d2fdd249d1b06ff9fabb6e47dd0f`** (the base this branch forked from) — recorded here as a dated
observation for reproducing the finding, not as permanent policy; the canonical file is authoritative for
the current value at any later time.

Attempting the documented `ops:lane-close --repair-merged` remediation surfaced a second, independent issue:
the merge-lock's liveness check (`process.kill(pid, 0)`) requires the lock-holding OS process to still be
running, which cannot hold across sequential CLI invocations from an orchestrating session (each
`pnpm ops:merge-lock`/`ops:lane-close` call is its own short-lived process) — every acquire is immediately
seen as `orphaned_pid` by the next invocation. This blocked the mechanical ghost-lane repair path itself.

This finding is now tracked as **UTV2-1558** (child of **UTV2-1553**), "Replace PID-liveness merge lock with
durable sequential-CLI ownership." Given the ghost lanes are pure bookkeeping drift (`UTV2-1501`/`UTV2-1506`
are fully merged into `main`; no incomplete work is at risk), this lane's branch and worktree were created
manually (not via `ops:lane-start`) rather than force through the blocked concurrency check, to avoid burning
further cycles on a defect this PR does not own the fix for. **This is a documented known exception, not a
ratified execution path** — this PR does not touch `scripts/ops/**`, does not fix the merge-lock defect, and
does not establish manual lane bootstrap as an approved substitute for `ops:lane-start`. UTV2-1558/UTV2-1553
own the durable fix; this planning lane is not blocking that work and should not be read as a second manual
bypass pattern to reuse.

`pnpm test:live-db` execution summary (aggregated across suites, from the full `pnpm verify` run):

```text
UTV2-1136 (settlement immutability):      4 pass, 0 fail
Dual-authorization / PnL correction:      4 pass, 0 fail
UTV2-1282/1459 (snapshot lookback):       3 pass, 0 fail, 1 skip (stale provider data, pre-existing)
UTV2-1327 (promotion-time enrichment):    6 pass, 0 fail
Atomic outbox claim (concurrency):        1 pass, 0 fail
```

Full `pnpm verify` exited 0 (`verify:static && pnpm test:live-db`, no failures at any stage). `pnpm test:live-db`
runs `pnpm test:db && pnpm test:t1-proof:live`; the `pnpm test:db` component's own literal TAP output
(`tsx --test apps/api/src/database-smoke.test.ts`, run standalone against the same branch head to capture
clean output) was:

```text
TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 111416.875663
```

`pnpm test:db` command: `tsx --test apps/api/src/database-smoke.test.ts`, run directly against real Supabase
(live-DB smoke gate, no in-memory repos). This lane performed no production data mutation — the smoke suite
creates and cleans up its own test rows.
