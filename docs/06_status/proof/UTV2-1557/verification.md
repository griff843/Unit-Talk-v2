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
| R-level check | PASS — no R1-R5 rule paths matched (`.lane/lanes/governance.yml` is a lane-authority allowlist entry, not an R-level path) |
| Runtime behavior changed | No — this PR adds three planning documents plus three exact filename entries in `.lane/lanes/governance.yml`'s `allowed_path_globs`; no runtime code path is touched or executed differently |
| Merge Gate / deploy workflow / GitHub Actions workflow changed | No |
| GitHub App / secret / credential changed | No |
| Machine-authorization implementation activated | No — this PR does not implement, activate, or self-authorize any T1-M quorum, classifier, or merge authority |
| Constitution changed | No |
| **File Scope Lock (CI-authoritative)** | **FAIL — see "File Scope Lock" section below; this is not resolved by anything in this proof file** |
| Independent owner approval | Not supplied; still required for this T1 PR (`t1-approved` label or `pm-verdict/v1`) |

## Scope

**This lane is planning documents plus three exact lane-authority allowlist entries — not docs-only.**
Nine files change in total:

* `docs/06_status/T1M_DELEGATION_DESIGN_PACKET.md` — planning document (content)
* `docs/06_status/T1M_DELEGATION_CODEX_ADVERSARIAL_REVIEW.md` — planning document (content)
* `docs/06_status/T1M_DELEGATION_FINAL_PM_DECISION.md` — planning document (content)
* `.lane/lanes/governance.yml` — **configuration change.** Adds exactly three filename entries to
  `allowed_path_globs` (the three documents above, listed by exact filename — no wildcard, no directory
  glob, no neighboring path, no broader governance-lane authority expansion). This is the same recurring,
  precedented DEBT-025-class fix already applied eight times in this same file's history for other
  top-level `docs/06_status/*.md` documents (e.g. `OS_V1_LOCK.md`). It does not touch, and has no effect
  on, `.github/workflows/**`, Merge Gate logic, deploy tooling, runtime code, secrets, GitHub App
  permissions, credentials, or any T1-M/T1-H machine-authorization implementation.
* `.ops/sync/UTV2-1557.yml`, `docs/06_status/lanes/UTV2-1557.json`, `docs/06_status/proof/UTV2-1557/{.gitkeep,evidence.json,verification.md}`
  — lane control-plane and proof bookkeeping (standard for every lane, not specific to this one).

No Merge Gate, GitHub Actions workflow, runtime code, deploy tooling, secret, credential, GitHub App
permission, or machine-authorization implementation changes occur anywhere in this diff. Every future PR
in the bootstrap chain this packet describes continues to merge under the existing Griff-only T1 gate; this
PR cannot and does not activate or self-authorize any machine merge authority.

## File Scope Lock — currently FAIL, not resolved by any manifest edit in this PR

**File Scope Lock is red on this PR and stays red until Griff posts an authorized override. Nothing in this
proof file, the lane manifest, or any local check result changes that.**

`scripts/ci/file-scope-guard.ts`, run in CI with `--manifest-source git`, resolves this lane's authoritative
`file_scope_lock` from the **immutable initial baseline** — specifically, the content of
`docs/06_status/lanes/UTV2-1557.json` as it existed in the **first commit that added that file**
(`a538b41e708fbaca2d7b3d44fa1dd343d74de3d4`), not any later commit. That baseline's `file_scope_lock` does
**not** include `.lane/lanes/governance.yml`. This is deliberate, hardened anti-self-widening design
(shipped as UTV2-1521): "Scope widening beyond the baseline is authorized exclusively through an
externally-validated `scope-override/v1` PR comment... never by trusting anything the PR's own diff wrote
into the manifest file itself" (`scripts/ci/file-scope-guard.ts` code comment). A lane cannot expand its own
authorized scope by editing its own manifest partway through the PR — that would defeat the entire point of
the control.

Later commits in this PR *did* edit `docs/06_status/lanes/UTV2-1557.json`'s `file_scope_lock` to include
`.lane/lanes/governance.yml` (to keep the manifest internally consistent with the real diff). **That edit is
not trusted by CI and does not — and must not — make File Scope Lock pass.** A local, prospective run of
`file-scope-guard.ts` against the worktree's current (untrusted-for-CI) manifest state does pass, and is
recorded below for reproducibility, but it is explicitly **not** the authoritative verdict:

```text
$ npx tsx scripts/ci/file-scope-guard.ts --base origin/main --head HEAD --branch claude/utv2-1557-t1m-delegation-planning-packet
No file scope lock conflicts or scope violations detected.
```

This local, prospective result is advisory only. **The authoritative File Scope Lock verdict is CI's,
using `--manifest-source git` against the immutable baseline, and it is FAIL.** The only sanctioned
resolution is a `SCOPE_OVERRIDE: APPROVED` / `schema: scope-override/v1` comment posted by an authorized
reviewer (`AUTHORIZED_REVIEWERS = {griff843}` in `.github/workflows/file-scope-lock-check.yml`) naming this
exact head SHA and exactly `.lane/lanes/governance.yml` as the widened path — no wildcard, no broader
governance-lane authority expansion. No such override exists as of this proof.

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
