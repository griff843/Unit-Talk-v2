# PROOF: WORK-2026101401

MERGE_SHA: pending merge

Issue: WORK-2026101401
Tier: T1
result: pending_exact_head_staging_ci_and_independent_review

Verified source: ccd89881c064aa68de1e0eac8faab9d5686b60b3
Implementation source: 9c28a7308d28cfbe48a1c3ad48508ec6cd6c9d21

## Continuation context

Desktop root and bounded implementation/review agents completed the candidate before any CLI runner invocation. Preserve that authorship; no historical CLI model execution is claimed. The current task is final validation, honest proof and draft PR preparation, rather than a new implementation. Do not merge, deploy, send Discord messages or release delivery. Required staging DB proof is deferred to CI by the admitted manifest; do not change the localhost staging guard.

The human explicitly approved the additional one-line package.json test:apps wiring in this chat on 2026-10-14 (local date). Commit ccd89881c appends four new direct test commands and retains every prior command. Original immutable ten-file scope lock stays unchanged. An externally authored exact-PR/HEAD package.json scope override and independent PM merge review remain pending.

## ASSERTIONS:

- [x] Pure canonical capper settlement/correction, units and ROI calculation: member-performance.test.ts.
- [x] Actual Database/InMemory reader methods: stable complete pagination, caps, exact multiples, duplicates, ordering, errors and realistic PostgREST 416 boundary: member-performance-read-completeness.test.ts. Query doubles, not live database proof.
- [x] Complete public-safe settled aggregation, source/delivery provenance and resource/consistency refusal: member-performance-service.test.ts.
- [x] Existing endpoint contracts, operator/bot authentication, privacy and refusal behavior: member-performance-routes.test.ts.
- [x] Sanctioned staging persistence proof for candidate c30a0120c and its GitHub integration commit 33e51534a.
- [ ] Required final current-head CI.
- [ ] Independent PM exact-head scope and merge approval.

## EVIDENCE:

```text
Source 9c28a7308d28cfbe48a1c3ad48508ec6cd6c9d21:
Focused new tests + existing member-picks regression: 182 passed, 0 failed.
New focused files: domain 17; DB reader 100; service 32; routes 6 (155 total).

Source ccd89881c064aa68de1e0eac8faab9d5686b60b3 (same tested source bytes, wiring appended):
pnpm ops:automation-coverage-check: PASS; new unwired tests 0.
pnpm verify: static portion PASS, final command exit 1 at staging identity guard.
Summed node:test suite totals from this verification log: 7841 tests, 7828 pass, 13 skipped, 0 fail.
pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD: PASS.
```

Raw logs retained in control checkout .out/discord-server-snapshot-20261014/: performance-approved-pnpm-verify.log, performance-approved-wiring-check.log, performance-approved-r-level.log, performance-exact-head-focused-regression.log. The full verify chain completed lint, type-check, build, full tests, Smart Form verification and command/migration checks before its DB identity refusal.

## Verification

The suite ran against the exact bytes subsequently committed as ccd89881c; no source changes followed that run. The local writable DB assertion refused host=127.0.0.1, ref=unidentified, expected=xskgrzbteyqdufktjrjx before database smoke execution. This is not a full pnpm verify PASS. The required current-head staging-ci workflow must supply its own actual receipt. No production writes or schema changes occurred.

Known limitation: two complete stable read snapshots detect observed differences but do not provide database transaction snapshot isolation. Exhaustion or uncertainty returns unavailable instead of a partial aggregate. Member browser acceptance of the repaired commands requires separately authorized deployment; local passing tests are not live acceptance.

## Actual staging persistence proof

CI run https://github.com/griff843/Unit-Talk-v2/actions/runs/38673297386 job116221129046 completed successfully at 2026-10-15T03:00:04Z, including both pnpm test:db and all configured T1 live proof suites. The authenticated CI receipt reports pnpm test:db exit0, 9tests/9pass/0fail/0skip, target xskgrzbteyqdufktjrjx. It ran against GitHub PR integration SHA33e51534a23bfcc88b0c24ae3ccb5b6ea6b526de, whose verified parents are main2be2aec814f54f62578dc3f1c206e1082b604888 and candidate c30a0120c84d651b1ebbc7caf7e142c2c3283921. Do not relabel its integration SHA as the PR head.

Full ci-db-proof-receipt/v2 and exact live smoke query/count assertions are included in evidence.json. Receipt SHA256 adc990170077d26d364c32366662d610b43c7980b47c32b5dc0ecc0e7f20602f. The passing smoke asserts exactly one base settlement after correction and zero rows after invalid settlement/delivery attempts, using unique staging fixtures. These are generic canonical persistence/atomicity gates, not live HTTP performance endpoint acceptance or live large-population pagination stress. The new reader methods have focused query-double tests; deployment/browser acceptance remains separate.

Independent source review of API/domain/wiring and a separate non-author review of the DB readers found no additional confirmed implementation blocker at c30a0120c. Neither review is PM merge authority. Their reports are retained in the control .out evidence directory.

## Subsequent governed CLI validation

The normal ops:codex-exec runner actually invoked its configured gpt-5.6-sol/medium model after candidate validation. Its unchanged measured model-routing.json records exit 1, 17536 prompt bytes and 250828 ms. It reran the 155 focused tests successfully, then incorrectly classified the separately approved package.json addition using the older immutable task packet and reverted it in the working tree. Root interrupted that pass and restored package.json byte-for-byte from the approved commit. The failed invocation is provenance, not a successful validation or replacement for Desktop authorship. No successful CLI result is claimed. Draft CI can proceed; final execution/scope and PM authority remain open.

## Remaining command acceptance limitation

An independent offline Discord compatibility review found an existing /stats selected-user issue: the bot sends Discord nickname/global name/username while this API filters canonical capper ID or unique canonical name. A differing nickname can yield an empty filtered response despite canonical history. Static payload/renderer contracts otherwise align. This is not a deployed success claim, and stable Discord-to-capper identity repair requires separate explicit scope. Full selected-user member acceptance remains open.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: b41cc8c7aa71aa3af466f1d0a8e7cf9b2a9598ab
