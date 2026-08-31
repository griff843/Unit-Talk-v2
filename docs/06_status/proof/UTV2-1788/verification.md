# PROOF: UTV2-1788 — Command Center stabilization verification

## Merge SHA Binding

MERGE_SHA: 14ca65db6a2ca45e4fdbdd3c2c27d57bb08554d5
Head SHA: 216098727bf2508393adb3902137aade4f04697d
Merge SHA: 14ca65db6a2ca45e4fdbdd3c2c27d57bb08554d5
Execution SHA: 216098727bf2508393adb3902137aade4f04697d
Diff base: origin/main at the time of this binding

`21609872` is this branch's last non-proof commit -- the `main` sync that
carries every implementation change under review. It is execution identity, not
merge authority: the authoritative merge SHA does not exist until the PR merges,
at which point `post-merge-lane-close.yml` rebinds these anchors to it. The
proof-only commit that adds this section sits on top of `21609872` and changes
no implementation byte.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Command Center type-check | PASS | `pnpm --filter @unit-talk/command-center type-check`, exit 0 |
| Command Center build | PASS | `pnpm --filter @unit-talk/command-center build`, exit 0; 56 dynamic routes including `/settlement` |
| Command Center unit tests | PASS | `pnpm --filter @unit-talk/command-center test`; 132 passed, 0 failed |
| Static repository gate | PASS | `pnpm verify:static`, exit 0 |
| Full repository gate | PARTIAL / EXPECTED REFUSAL | All static stages passed; writable DB leg refused the unidentified loopback target before constructing a client |
| Desktop/mobile E2E | PASS | `COMMAND_CENTER_AUTH_MODE=fail_open pnpm exec playwright test e2e/command-center.spec.ts`; 2 passed against the production build, all six workflows at 1440x1000 and 390x844 |
| Screenshots | PASS | 12 PNGs under `screenshots/`, one desktop and one mobile capture for each primary workflow |
| Standalone Docker attempt | BLOCKED BY HOST | Docker client 29.7.2 present; daemon socket unavailable, so no Dockerfile instruction executed |
| Diff whitespace | PASS | `git diff --check`, exit 0 |
| R-level compliance | PASS | `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`; `operator-ui` requires `qa-experience`, and the repository artifact requirement is present |
| Independent exact-head review | PASS | Independent reviewer found no blocking findings at implementation SHA `a03d15cb02e562d7bf620b6f3a84c0a5054fc253` |

### Static gate evidence

`pnpm verify:static` completed the canonical sequence: privileged-client boundary, sync/alignment/automation gates, environment validation, lint, `pnpm type-check`, `pnpm build`, `pnpm test`, Smart Form verification, and command/migration checks. The automation gate reported only the repository's pre-existing baselined QA-agent glob warning and no new unwired tests.

### Focused test evidence

```text
1..132
# tests 132
# pass 132
# fail 0
# cancelled 0
# skipped 0
```

New focused coverage is placed under `src/lib/`, which the existing package script executes:

- `command-center-nav.test.ts`: filesystem/registry equality, all classifications, exact six primary routes, parent mapping, workspace derivation.
- `operator-truth-rendering.test.ts`: unavailable metrics never render as healthy zeroes.
- `describe-error.test.ts`: operator-safe bounded degradation messages.
- `fire-board-model.test.ts`: consolidated navigation targets.
- `data/dashboard.test.ts`: governed review lifecycle state is preserved, unknown states stay unknown, and the daily KPI uses complete UTC calendar windows.
- `primary-metrics.test.ts`: Today's Picks uses the measured daily bucket and preserves a missing measurement as unknown.

### Full gate and writable DB disposition

`pnpm verify` ran `pnpm verify:static` successfully and then reached `test:live-db`. The staging assertion refused the configured loopback target:

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
Writable DB verification requires xskgrzbteyqdufktjrjx.
Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=unparseable/loopback). Writable DB verification requires `xskgrzbteyqdufktjrjx`. Run it through the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials. No database write was attempted, and this app-only T2 lane makes no DB change.

### E2E and screenshots

The focused Playwright spec navigates via the rendered primary navigation, asserts the H1 and final URL for every primary workflow, waits for the mobile drawer transition, and captures full-page screenshots. The final capture ran against `next start` after a successful production build, so framework development diagnostics are not present in the evidence.

The wired `e2e/command-center.spec.ts` previously asserted the superseded Phase 1 dashboard contract (including health cards and a lifecycle table on `/`). It was replaced rather than retained as false coverage. The replacement exercises the current product boundary on desktop and mobile; focused component and state transformations remain covered by the 132 package tests.

| Workflow | Desktop | Mobile |
| --- | --- | --- |
| Overview | `screenshots/desktop-overview.png` | `screenshots/mobile-overview.png` |
| Review | `screenshots/desktop-review.png` | `screenshots/mobile-review.png` |
| Active Picks | `screenshots/desktop-active-picks.png` | `screenshots/mobile-active-picks.png` |
| Settlement | `screenshots/desktop-settlement.png` | `screenshots/mobile-settlement.png` |
| Exceptions | `screenshots/desktop-exceptions.png` | `screenshots/mobile-exceptions.png` |
| System Health | `screenshots/desktop-system-health.png` | `screenshots/mobile-system-health.png` |

The local capture used the existing `COMMAND_CENTER_AUTH_MODE=fail_open` override only as an ephemeral process environment so an uncredentialed workstation could render the internal UI. This is not production authorization evidence and did not change any env or auth file.

### Independent exact-head review

An independent reviewer examined implementation SHA `a03d15cb02e562d7bf620b6f3a84c0a5054fc253` and returned PASS with no blocking findings. The review independently confirmed:

- all 56 current page routes have unique registry classifications and exactly six are primary;
- the shell, command palette, and workspace navigation derive from the single route registry;
- primary surfaces degrade honestly, including exact per-day, Review, and Active Picks counts;
- deferred direct routes are visibly classified and the duplicate page headers remain removed;
- excluded authentication/configuration files are unchanged and the production `fail_open` defect remains a Tier C residual;
- all mutations still use canonical API POST server actions, with no direct Supabase write;
- the diff has no Smart Form, production, API, worker, package, migration, workflow, or other prohibited overlap.

The reviewer also reproduced the focused test result (132/132), Command Center type-check, route-registry checks, diff checks, and scope checks. The final proof-only commit is rechecked separately before PR creation so no implementation behavior changes after this verdict.

### Docker attempt

Command attempted from the repository root:

```text
docker build -f apps/command-center/Dockerfile -t unit-talk/command-center:utv2-1788-proof .
```

Result: blocked before build-context processing because `/var/run/docker.sock` is unavailable. `docker version` confirmed a 29.7.2 client and no reachable daemon; Podman, Buildah, and nerdctl are not installed. The in-scope Dockerfile corrections are static and buildable in shape: Node 22, repository-root workspace context, workspace package copy, filtered build, and no nonexistent `public/` copy. A hosted Docker-capable runner must execute the image build before any deployment lane may rely on it.

## ASSERTIONS: product and safety claims proven by this lane

- [x] The primary navigation contains exactly six workflows and is derived from the route registry.
- [x] All 55 baseline page routes are classified; the added `/settlement` route is also classified.
- [x] `/settlement` uses the existing `SettlementForm` and `actions/settle.ts` path to `POST /api/picks/{id}/settle`; no API authority is added.
- [x] Every Command Center mutation remains a server action that posts to the canonical API. No new direct write path exists.
- [x] Primary workflow fetch failures render degraded/unavailable states; fabricated catch payloads and inferred zero health are removed.
- [x] Overview's Today's Picks KPI uses an exact current-day count from complete UTC day bounds rather than a capped row window; any unavailable daily count degrades the entire series. Review and Active Picks likewise require authoritative exact query counts.
- [x] Deferred routes are absent from primary navigation and receive an explicit classification banner when directly visited.
- [x] Request-time privileged reads are forced dynamic, preventing image build from presenting build-time data as runtime truth.
- [x] The Tier C auth/config files named in the authorization correction are byte-unchanged.
- [x] No file overlaps Smart Form Phase 1 or the production deployment/recovery lanes.

## EVIDENCE: executed command receipts

Every row in the Verification table above was produced by one of these runs. The
focused package suite is reproduced verbatim:

```text
$ pnpm --filter @unit-talk/command-center type-check   -> exit 0
$ pnpm --filter @unit-talk/command-center build        -> exit 0 (56 dynamic routes, including /settlement)
$ pnpm --filter @unit-talk/command-center test         -> exit 0
1..132
# tests 132
# pass 132
# fail 0
# cancelled 0
# skipped 0

$ pnpm verify:static                                   -> exit 0
$ pnpm type-check                                      -> exit 0 (inside verify:static)
$ pnpm test                                            -> exit 0 (inside verify:static)
$ pnpm verify                                          -> static stages exit 0; test:live-db refused a loopback target (see below)
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD -> exit 0
$ git diff --check                                     -> exit 0
$ COMMAND_CENTER_AUTH_MODE=fail_open pnpm exec playwright test e2e/command-center.spec.ts -> 2 passed
$ docker build -f apps/command-center/Dockerfile ...    -> BLOCKED BY HOST (no reachable daemon)
```

The writable-DB leg is not claimed as executed. `pnpm test:db` did not run
against a real database on this workstation; the staging assertion refused the
loopback target before any client was constructed, and this app-only T2 lane
makes no DB change. CI's `Writable DB proof (staging only)` job carries the
authoritative receipt for this head.

## Residual risks and deferred work

### Tier C authentication defect — unchanged

Production normally requires auth, but an explicit `COMMAND_CENTER_AUTH_MODE=fail_open` (or its aliases) is evaluated before environment mode and can authenticate an uncredentialed production request as a full operator through `dev_bypass`. Both the app and root example env files expose the unsafe default. Fixing precedence, middleware behavior, tests, or env defaults is a security/configuration posture change and belongs to the PM-directed Claude Tier C successor. This lane does not modify `server-api.ts`, `middleware.ts`, `.env.example`, auth behavior, or auth tests.

### Privileged reads — deployment blocker

Command Center continues to read Supabase through service-role `getDataClient()` across its data modules. `/intel/teams` constructs that client at page level, and `storage-health.ts` calls the Supabase Management API database-query endpoint. These existing read authorities were not expanded or redesigned. They must be reviewed before a deployment lane can expose Command Center.

### Structurally unwired tests

The unchanged package test glob still excludes four existing files: the governance route test, `command-center-pages.test.tsx`, stale `command-center-rebuild.test.tsx`, and `shared-components.test.tsx`. Deleting the stale rebuild test caused the repository automation baseline to demand an out-of-scope governance/config update, so it was restored unchanged. Fixing the glob or baseline requires the separately authorized package/build-config lane. All new tests in this lane are wired under `src/lib/`.

### Deployment status

Command Center is **still not production-deployed**. No workflow publishes its image and no production compose or deployment configuration is changed here. Deployment requires a separate lane after authentication, privileged-read, hosted Docker-build, and production-configuration review.

## Scope and overlap evidence

- Changed implementation path: `apps/command-center/**` only.
- Authorized control/proof paths: `.ops/sync/UTV2-1788.yml`, `docs/06_status/lanes/UTV2-1788.json`, `docs/06_status/proof/UTV2-1788/**`.
- Smart Form lane UTV2-1787 owns `apps/smart-form/**`, selected API/contracts/DB paths, and shares zero files.
- Open PRs identified in the captured work order share zero Command Center files.
- No `deploy/production/**`, workflow, API, worker, contracts, domain, DB package, migration, env, or secret path is changed.
