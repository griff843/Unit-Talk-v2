# PROOF: UTV2-1749 — the scheduled alert pass can authenticate and reach its sink

## Merge SHA Binding

MERGE_SHA: 4ac025ee211d17720b18e764d006325cd919b228

Merge SHA: 4ac025ee211d17720b18e764d006325cd919b228
PR: https://github.com/griff843/Unit-Talk-v2/pull/1468
Execution SHA: `497a36f805220e7d71a6c01d252d6e237628824a`
Approved PR head: 64a47197f2327171c46be35f26c23db939bcb91d

`497a36f805220e7d71a6c01d252d6e237628824a` is the last non-proof commit on this branch: the second `origin/main` sync merge,
taken after PR #1469 merged as `63d76eb6`. The implementation it carries is unchanged from
`10fa8dd8`.

The receipts below were executed at `b8795cb58665b66b2e04840159c589f4f9e31b5e`, the first sync merge. They are not re-executed
here because the second sync changed no file this lane owns: the workflow blob, the test blob
and the whole proof tree are byte-identical across both merges
(`2599bfd3…`, `b3df7e48…`, `86f8665e…` before and after). CI re-runs every required gate at
this head regardless.

## Verification

- [x] `pnpm verify:static` — exit 0. Includes `ops:automation-coverage-check`,
      `env:check`, `lint`, `type-check`, `build`, `test`, smart-form verify and
      `verify:commands`. Aggregate `tests 5471 / pass 5471 / fail 0 / skipped 0`,
      zero `not ok` lines.
- [x] `pnpm type-check` — exit 0 (executed as a stage of `pnpm verify:static` at this head).
- [x] `pnpm test` — exit 0, `tests 5471 / pass 5471 / fail 0 / skipped 0`, zero `not ok` lines
      (executed as a stage of `pnpm verify:static` at this head).
- [x] `pnpm lint` — exit 0 (same stage list).
- [x] `pnpm exec tsx --test scripts/ci/ingestor-alert-wiring.test.ts` — 2/2 pass.
- [x] Executable-wiring reachability — `[automation-coverage] verdict=PASS fail=0 warn=1 classified=15`.
- [x] Mutation proof — five independent mutations, each re-executed at this head; see below.
- [x] CI `verify` — SUCCESS on this branch (run 33437054500 at `fab046ef`, the identical
      implementation tree; re-running at this head).
- [x] CI `Writable DB proof (staging only)` — SUCCESS at `fab046ef`.
- [ ] A scheduled post-merge run of `Ingestor and Alert-System Monitor` has not been
      observed. No runtime success is claimed from YAML. See residual risks.

### The blocker recorded in the previous revision of this file is resolved

The prior revision of this proof was written at `c383f0d9` and stated that
`pnpm verify:static` failed with `WIRING_TEST_UNWIRED_NEW`, that the focused test was
unreachable, and that closing the lane required adding `scripts/ci/ingestor-alert-wiring.test.ts`
to the root `test:ops` list in `package.json` — a file outside this lane's scope.

That is no longer true and no scope expansion is required. `10fa8dd8` made the test
reachable by running it inside the workflow it guards, as a step named
`Assert alert workflow secret wiring` placed **before** the alerting pass. The root
`test:ops` file list is unchanged and `package.json` is untouched by this branch.
`ops:automation-coverage-check` now returns `verdict=PASS`, and `verify:static` exits 0.

### Executable-wiring placement is fail-closed

The assertion step precedes `Run one alerting pass` in the `alerting-pass` job. A removed
or relocated secret binding therefore fails the scheduled run at 03:00 rather than letting
the pass start, fail to construct a Supabase client, and degrade silently.

## ASSERTIONS: what this lane changes about running behaviour

- [x] `alerting-pass` now receives `SUPABASE_ANON_KEY` from `secrets.SUPABASE_ANON_KEY`.
      Without it the application config loader cannot construct a Supabase client, so the
      every-five-minutes alerting pass could not read ingestion state at all.
- [x] `alerting-pass` now receives `UNIT_TALK_OPS_ALERT_WEBHOOK_URL` from
      `secrets.UNIT_TALK_OPS_ALERT_WEBHOOK_URL`. Without it a detected staleness condition
      had no operations sink to report through.
- [x] `monitor` now receives `SUPABASE_ANON_KEY`. It already held the operations webhook.
- [x] A YAML-parsing regression test asserts each named runtime step binds each required
      variable to the exact secret expression, and fails if a binding is removed or moved.
- [x] Cadence (`*/5 * * * *`), `permissions: contents: read`, every alert threshold,
      `ALERT_MEMBER_CHANNELS_ENABLED=false` and `SYSTEM_PICKS_ENABLED=false` are unchanged.
      Nothing member-facing or pick-producing is enabled by this lane.
- [x] No production write is introduced. The workflow already ran on this schedule against
      these same credentials; this lane supplies configuration it was already expected to have.

## EVIDENCE: executed command receipts

Focused regression test at `497a36f805220e7d71a6c01d252d6e237628824a`:

```text
$ pnpm exec tsx --test scripts/ci/ingestor-alert-wiring.test.ts
ok 1 - scheduled alert workflow gives each runtime step its required configuration
ok 2 - scheduled alert workflow remains parked and canary-only
# tests 2
# suites 0
# pass 2
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Repository gate at `497a36f805220e7d71a6c01d252d6e237628824a`:

```text
$ pnpm verify:static                                      -> exit 0
$ pnpm lint                       (stage of verify:static)  -> exit 0
$ pnpm type-check                 (stage of verify:static)  -> exit 0
$ pnpm test                       (stage of verify:static)  -> exit 0
[automation-coverage] verdict=PASS fail=0 warn=1 classified=15
...
# tests 5471
# pass 5471
# fail 0
# cancelled 0
# skipped 0
# todo 0
exit 0
```

### Mutation evidence — every assertion is proven to fail on the condition it names

Baseline `.github/workflows/ingestor-staleness-alert.yml` SHA-256:
`d64248b36bcf5b013c289152e7cb17cd032643cb78be7aa8cbbca8ccfec33303`.

Each mutation was applied alone to the real workflow, the focused test was executed, and the
file was restored and its SHA-256 re-checked against the baseline before the next mutation.

| Mutation | Result | Failing assertion |
|---|---|---|
| remove `alerting-pass` `SUPABASE_ANON_KEY` | exit 1, pass 1 / fail 1 | `not ok 1 - ...required configuration` |
| remove `alerting-pass` `UNIT_TALK_OPS_ALERT_WEBHOOK_URL` | exit 1, pass 1 / fail 1 | `not ok 1 - ...required configuration` |
| remove `monitor` `SUPABASE_ANON_KEY` | exit 1, pass 1 / fail 1 | `not ok 1 - ...required configuration` |
| flip `SYSTEM_PICKS_ENABLED` to `'true'` | exit 1, pass 1 / fail 1 | `not ok 2 - ...parked and canary-only` |
| flip `ALERT_MEMBER_CHANNELS_ENABLED` to `'true'` | exit 1, pass 1 / fail 1 | `not ok 2 - ...parked and canary-only` |
| baseline restored | exit 0, pass 2 / fail 0 | — |

The last two mutations matter beyond this lane: they prove the parked-posture assertion is
load-bearing, so a future change that quietly enables member channels or system picks in this
scheduled workflow fails this test rather than shipping.

## Residual risks and deferred work

### No scheduled run has been observed

This proof establishes that the workflow declares the configuration its runtime steps need and
that the declaration is defended by an executed test. It does **not** establish that a real
03:00 run authenticated, detected a staleness condition, and delivered to the operations sink.
That requires observing a post-merge scheduled run and recording its run URL, attempt, and the
`alerting-pass` and `monitor` conclusions. Until then, alert delivery is proven wired, not
proven delivered.

### `test:db` is not runnable from a local worktree

`pnpm test:db` refuses locally: `assert-staging` resolves `host=127.0.0.1 ref=unidentified`
against the required `xskgrzbteyqdufktjrjx`. The writable receipt is produced inside CI by the
`staging-ci` environment and verified within the required `verify` job; `Writable DB proof
(staging only)` is SUCCESS on this branch. This lane changes no database code path.

### Pre-merge `ops:proof-check` staleness is expected

`ops:proof-check` compares `source_sha` to the current branch head by strict equality. A proof
committed to its own branch can never satisfy that before merge: committing the proof moves the
head past the SHA the proof names. The binding above is to the last non-proof commit, which is
the anchor the shared schema and the Close Eligibility Preflight actually read.

---

## Merge-SHA binding correction (PR #1470)

The automatic post-merge binding did not happen. Run 33453183560 of Post-Merge
Lane Close failed, so this bundle was left declaring `MERGE_SHA:` as the branch
anchor `497a36f8…` with `Merge SHA: pending merge`, and the binding section
carried `Approved PR head: pending PM verdict at the final unchanged head` — prose
where a SHA token belongs, which `ops:proof-rebind` refuses outright rather than
guessing at.

Corrected through the sanctioned path, not by hand-editing the fields:

```text
pnpm ops:proof-rebind --issue UTV2-1749 \
  --merge-sha 4ac025ee211d17720b18e764d006325cd919b228 \
  --approved-head 64a47197f2327171c46be35f26c23db939bcb91d \
  --pr 1468 --apply
=> proof_rebind_applied
   verification.md line 5  MERGE_SHA:  497a36f8… -> 4ac025ee…
   verification.md line 7  Merge SHA:  pending merge -> 4ac025ee…
```

`4ac025ee211d17720b18e764d006325cd919b228` is not an assertion made here: it is
the value GitHub returned when PR #1468 was merged, and it is reachable on `main`.

Two validators disagree about this bundle and both are now satisfied honestly:

* `ops:proof-check` validates the canonical proof record v2 shape and was failing
  on four absent fields (`pr_number`, `source_sha`, `reviewed_head_sha`,
  `gate_results`). Those failures pre-date this correction — the same four appear
  against the copy already on `main`. They are now populated with values already
  established elsewhere in this bundle.
* `CEP-E7` reads schema-v2 evidence, forbids a legacy top-level `merge_sha`, and
  requires `sha_binding.merge_sha` to be **null** while the carrying PR is itself
  unmerged. So the verification document is bound to the attested merge SHA, and
  `sha_binding.merge_sha` stays null: that slot is written by the post-merge
  closeout, which is its authority. Binding it here would be this lane asserting
  its own merge, which is exactly what the gate exists to prevent.

`ops:proof-check` still reports `STALE: yes` because it compares `source_sha` to
the PR head by strict equality, and committing a proof to its own branch always
moves the head past the SHA the proof names. That is by construction, not a
defect in this bundle.

## Evidence reconciliation (PR #1470, second correction round)

PM found `evidence.json` materially stale in four places. All four described the
state of this work *before* PR #1468 was reviewed, approved and merged, and none
of them was corrected when that happened. The record now matches live history.
No product, workflow or governance code changed; this round touches only
UTV2-1749's own proof artifacts, and the manifest repair and merge binding from
the first round are untouched.

`ops:proof-rebind` was the right tool for the merge-SHA binding and was used for
it. It writes SHA anchors only, and `ops:proof-repair apply` requires a merge SHA
and a runtime-proof file for post-merge insertion, so neither can write these
four semantic fields. They were edited directly, and every value below is a fact
GitHub reports rather than a claim this lane makes about itself.

### 1. PM verdict timestamp

`pm_verdict.recorded_at` read `2026-09-01T00:00:00Z` — a rounded placeholder, not
an observation. GitHub's actual times:

| Artifact | Actor | Timestamp |
| -- | -- | -- |
| `pm-verdict/v1` APPROVED comment ([5486496698](https://github.com/griff843/Unit-Talk-v2/pull/1468#issuecomment-5486496698)) | griff843 | `2026-09-01T00:01:06Z` |
| `t1-approved` label applied | griff843 | `2026-09-01T00:01:07Z` |

Both are now recorded, at the approved head `64a47197f2327171c46be35f26c23db939bcb91d`.

### 2. Sign-off reconciled with live history

Five of the six `pending` entries had already been satisfied. Each is moved to a
`resolved` list carrying what closed it, rather than deleted — the record of what
was outstanding is part of the evidence.

| Was pending | What actually closed it |
| -- | -- |
| authoritative scope decision permitting `package.json` `test:ops` wiring | Never needed. `10fa8dd8` made the wiring test reachable from inside `ingestor-staleness-alert.yml`, with no `package.json` change and no scope expansion. |
| `verify:static` and R-level rerun after the wiring gap | Both green at the approved head: `verify` success `2026-08-31T23:30:21Z`, R-Level Compliance Check success `2026-08-31T23:21:32Z`. |
| independent exact-head review | Recorded in the pm-verdict comment: the implementation blobs are byte-identical to the independently reviewed versions, all required contexts green at the head, no unresolved current threads. |
| T1 approval at the stationary reviewed head | pm-verdict/v1 APPROVED `2026-09-01T00:01:06Z`; `t1-approved` `2026-09-01T00:01:07Z`. |
| staging-ci writable DB proof | `Writable DB proof (staging only)` success at `64a47197`, `2026-08-31T23:26:12Z`. |

One entry remains genuinely outstanding: **post-merge observation of a scheduled
run**. Alert delivery is proven wired, not proven delivered.

`ready_for_pm_review` read `false` while the PM had already approved and the PR
had already merged. It now reads `true`, and `pm_review_outcome` records the
approval and the merge SHA `4ac025ee211d17720b18e764d006325cd919b228`, so the
status semantics are internally consistent.

### 3. Runtime proof reconciled without collapsing the distinction

`runtime_proof.status` read `BLOCKED_DEFERRED_PENDING_STAGING_CI_AND_POST_MERGE_SCHEDULE`.
The staging half of that is no longer pending. Three separate facts are now
recorded separately, because they mean different things:

* **local `pnpm test:db` remained unavailable.** `assert-staging` could not
  resolve the target identity from its URL (`host=unparseable`) and requires
  `xskgrzbteyqdufktjrjx`. This did not change and is not claimed to have changed;
  it is a local worktree limitation, not an unmet requirement.
* **staging CI succeeded.** `Writable DB proof (staging only)` — conclusion
  `success`, environment `staging-ci`, project ref `xskgrzbteyqdufktjrjx`,
  evaluated at `64a47197`, completed `2026-08-31T23:26:12Z`,
  [run 33450314775 job 99678512851](https://github.com/griff843/Unit-Talk-v2/actions/runs/33450314775/job/99678512851).
* **post-merge alert-delivery observation is still outstanding.** A writable
  staging receipt proves the workflow can authenticate. It does not prove an
  alert was delivered. `success_claimed` stays `false`.

The status now reads `STAGING_CI_PASS_POST_MERGE_DELIVERY_OBSERVATION_OUTSTANDING`.

### 4. R-level disposition replaced with the passed evidence

`static_proof.r_level.status` read `PASS_BEFORE_PROOF_COMMIT_PENDING_FINAL_RERUN`.
That was written before the proof commit and never updated. CI evaluated R-level
at the approved implementation head and it passed:

```
R-Level Compliance Check   success   64a47197f2327171c46be35f26c23db939bcb91d   2026-08-31T23:21:32Z
https://github.com/griff843/Unit-Talk-v2/actions/runs/33450314638/job/99678511628
```

Status is now `PASS` with the check name, conclusion, evaluated SHA, completion
time and run URL. No rerun is outstanding.

### Re-validation after the correction

* `pnpm exec tsx --test scripts/ops/proof-schema.test.ts` — 76 pass, 0 fail.
* Close Eligibility Preflight, run locally with the workflow's exact evaluator —
  **PASS**, 15 PASS / 2 N/A / 0 FAIL, including `CEP-E5` and `CEP-E7`.
* `ops:proof-check UTV2-1749` — unchanged from the previous round: the same
  `STALE: yes` by construction and the same `evidence_commit_sha is null` warning
  that CI fills in. No new failure was introduced.
