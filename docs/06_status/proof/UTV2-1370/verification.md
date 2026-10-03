# PROOF: UTV2-1370

MERGE_SHA: 400c2962c5d51d2d2f7c5d4b228f5a891bd10930

Issue: UTV2-1370  
Tier: T1 / Tier C migration  
Result: production read-only verification and post-deploy parity PASS; governed closeout pending reconciliation merge

## ASSERTIONS:

- [x] Archive evidence is re-read through the reader-only object-store path and independently checked for manifest validity, checksum, Parquet readability, exact source/window, and row count before planning.
- [x] Planning and execution refuse stale or changed evidence, count mismatches, protected references, expired or oversized plans, active legacy pruning, wrong phase credentials, and any unsupported source.
- [x] The execution routine holds an advisory lock, locks the bounded source relation/partition, recounts, deletes an exact maximum-10,000-row window, verifies zero rows remain, and appends an immutable receipt.
- [x] `provider_offers_legacy_quarantine`, picks, settlements, lifecycle, delivery/outbox, receipts, audit/business truth, and archive objects are outside the deletion path.
- [x] `raw_payloads` and `odds_snapshots` immutability exceptions are transaction-local and exact-plan/window scoped inside SECURITY DEFINER routines; no caller receives direct table DELETE.
- [x] Recovery requires the original execution receipt, newly verified archive evidence, exact manifest and object fingerprints matching that receipt, an empty hot window, a bounded payload, exact row restoration, and an immutable recovery receipt; a mismatch refuses before any insert.
- [x] The disabled `nightly-retention-prune` job is asserted inactive and is never scheduled or enabled.

## EVIDENCE:

```text
candidate_source_sha=fec795f7a0997180bb61d146eac0b0755147bf52
parity_run_id=37036445782
parity_job_id=110935763319
parity_state=PASS
production_ddl_applied=true
post_deploy_obligation=post-deploy-before-lane-close
```

## Verification

- Exact refreshed execution SHA: `fec795f7a0997180bb61d146eac0b0755147bf52`.
- Sanctioned update commit `720653e30f6c725e3edb152998fc753756497d38` has parents `a3bc984a066225b3e030d88c719179de71fadc1d` and `2775e91e4026fdf9ec35d78519796c217c1ed954`; candidate commit `14e25d858486d16925aa0eb6862fcc1f8edbcf45` adds only the PM-requested recovery fingerprint binding and its regression coverage. Candidate commit `fec795f7a0997180bb61d146eac0b0755147bf52` supplies authenticated read-only access to authoritative parity receipts in the existing fail-closed migration proof gate and adds a static regression for that token binding.
- Migration run `36532308051`, job `109288503908`: apply → rollback → byte-equivalent schema → reapply passed. The same job's ephemeral PostgreSQL lifecycle proved stale/mismatched evidence refusal, 1 → 0 bounded prune, independent archive readback of 1 row, same-count changed-content recovery refusal with the hot window still empty, exact-fingerprint 0 → 1 recovery, reference protection, unchanged quarantine/business rows, disabled legacy cron, and no direct executor DELETE.
- Migration run `36532308051`, job `109288504197`: fail-closed precondition drill and empty-scratch application passed.
- CI run `36532307979`, job `109288828750`: canonical writable DB and T1 live-proof suites ran against governed staging and passed for the refreshed execution SHA; the same-run proof receipt uploaded successfully.
- Local `pnpm verify:static`: passed, including lint, type-check, build, 3,524 tests, Smart Form verification, migration version uniqueness, and migration lint.
- Local focused retention/proof suites: 18 passed, 0 failed, 1 live-DB case skipped without an explicit test DSN.
- `pnpm ci:db-client-boundary`: passed; all privileged driver construction sites remain classified and unreachable from `pnpm test`.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS; no additional R-level rules matched.
- Production writes/deletes performed by this lane: 0 / 0.

## Historical pre-merge phase-aware production parity obligation

Live Schema Parity run `36532308305`, job `109288572716` is the authoritative exact-source receipt for the candidate execution SHA. GitHub records the canonical `.github/workflows/live-schema-parity.yml` workflow, `pull_request` event, PR #1678, and immutable `run.head_sha=fec795f7a0997180bb61d146eac0b0755147bf52`. The trusted workflow guard, scratch migration apply, schema comparison, and parity-artifact upload succeeded; the job completed with the expected failure only at `Authorize schema drift gate` because production does not yet contain this unapplied migration.

The phase-aware migration contract records this pre-merge state as `PENDING_POST_DEPLOY` only because all of the following are independently true:

- the run belongs to the canonical Live Schema Parity workflow and targets the exact execution SHA;
- the comparison path completed and only the drift gate failed;
- `production_ddl_applied` is explicitly false; and
- production parity is bound to the `post-deploy-before-lane-close` phase.

After merge and sanctioned deployment, lane close still refuses this pending state. A new authoritative production Live Schema Parity `PASS` receipt is mandatory before the migration lane can close. No gate was weakened or bypassed, and no production DDL or pruning was executed during this candidate-proof refresh.

## Post-deployment production verification reconciliation — UTV2-1967

The original candidate source remains `fec795f7a0997180bb61d146eac0b0755147bf52`, original merged PR head remains `70d6463af638a315559d77191029c4cd150a6647`, and original migration merge authority remains `400c2962c5d51d2d2f7c5d4b228f5a891bd10930` / PR #1678. Later production receipts have their own exact trusted-main head; they do not rewrite the original execution source or claim historical execution at merge time.

- Production read-only verifier: [run 37036085802 / job 110934527512](https://github.com/griff843/Unit-Talk-v2/actions/runs/37036085802/job/110934527512), exact SHA `41d659c36cec45c622cbcaaa16fa5ae28bdb1b27`, genuine PASS.
- Canonical production project `zfzdnfwdarxucxtaojxm`; actual session user `warehouse_reader`; `transaction_read_only=on`, `read_only=true`, `mutated=false`. All 137 migration versions reconcile, including `20260928131714`. All eleven schema/privilege/immutability facts in the immutable receipt are true.
- Verifier artifact `11240555923`, `production-post-migration-20260928131714-37036085802-1`; downloaded ZIP digest `sha256:f00f78b0477a7e10ff673bb8e66738b81063e810d0106e03a9754362cc3498ed`; receipt SHA-256 `6de6d1de400dfdc86f6855cec1979244dc5b1022a80f186093bcc90091968e6e`. Independent inspection binds repository, workflow, event, run, job, immutable head, upload step and receipt; downloaded ZIP digest matches GitHub's authoritative artifact digest.
- Production parity: [run 37036445782 / job 110935763319](https://github.com/griff843/Unit-Talk-v2/actions/runs/37036445782/job/110935763319), same exact production SHA, scratch apply / schema compare / drift gate PASS, unauthorized drift zero.
- Parity artifact `11241490211`, `live-schema-parity`, digest `sha256:1af53e937c2e04c35321fef2e37b9ea7a49c6b80cf4e6b1cbbb82233bd82b60c`; gate-receipt SHA-256 `8f08ed75bf9575d7c468a7f02990f9d2d46d13f8b9a0288749f94b5a362d8c93`. The pre-existing policy permits `pg_catalog.pg_cron`; reconciliation adds no allowlist or schema exception.
- Original-head Executor Result Validation was genuinely run now, not invented retrospectively: [check 111001369799](https://github.com/griff843/Unit-Talk-v2/runs/111001369799), authoritative validator workflow run `37056151893`, job `111001244076`, validates original PR head `70d6463af638a315559d77191029c4cd150a6647`. Executor result comment `5960137578` explicitly records its later provenance. The workflow existed at original merge time, so no historical required-check exemption was added.
- The immutable original manifest introduction `ffba3eb315c41557dc66949d35facb7e8e69d606` granted `t1_live_db_precondition=deferred_to_ci`. Recovery restores that obligation only from independently validated original-PR history; it creates neither a fresh ephemeral preflight token nor a new PASS. The current editable manifest is not authority.
- Follow-up commit `2139ebe071fdf68c9f65a3d0172e63f78b72617d` belongs to canonical repository-owned `WORK-2026092901` / PR #1697. G5 now requires its canonical lane record at that exact touching commit and owned overlapping paths; bare WORK text grants nothing.

The authorized production migration was applied earlier, outside this reconciliation lane. This lane performs no production DDL, credential/privilege changes, retention planning/execution/recovery, canary, pruning, production-row deletion, archive deletion, containment or delivery mutation. The intended one-row production retention canary remains **unexecuted** and requires a separate future PM decision. A manifest `done` claim is reserved for the subsequent actual canonical truth-check and closeout.

## Merge SHA Binding

Merge SHA: 400c2962c5d51d2d2f7c5d4b228f5a891bd10930
PR: https://github.com/griff843/Unit-Talk-v2/pull/1678  
Execution SHA: fec795f7a0997180bb61d146eac0b0755147bf52
