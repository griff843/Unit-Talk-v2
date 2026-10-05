# PROOF: WORK-2026100401 — canonical Shadow settlement count

MERGE_SHA: pending merge

Implementation SHA: `7240093fc6c610cb16355aeb313fb1b4d102142a`

Tier: T1 · Lane type: governance

Result: awaiting exact-HEAD CI, PM verdict, and post-merge trusted-base Shadow observation

## ASSERTIONS:

- [x] `settledResultBacked` no longer queries nonexistent `pick_candidates.outcome`.
- [x] Candidate `id,pick_id` links are read in stable pages because `pick_candidates.pick_id` has
      no FK.
- [x] Settlements are read in stable pages through the real `settlement_records.pick_id -> picks.id`
      FK and bounded pick-ID batches.
- [x] Only `win`, `loss`, or `push` rows with non-null `evidence_ref` and `status=settled` qualify.
- [x] Voided picks, `source=shadow` picks, null-submission picks, and every canonical
      `reporting.pick_fixture_reason` class are excluded.
- [x] A qualifying pick is deduplicated across original, duplicate, and correction settlement rows;
      each linked candidate is counted once.
- [x] Query errors and null data fail closed; zero-scan and side-effect guardrails remain covered.
- [x] The dedicated production reader retains zero accessible application-data mutation authority.
- [ ] Writable staging DB proof must run in current-HEAD CI with `CI_SUPABASE_*` credentials.
- [ ] A production Shadow result must run from the repaired trusted base after this repair merges.
- [ ] Exact-HEAD PM `pm-verdict/v1` approval and `t1-approved` are not yet present.

## EVIDENCE:

Canonical relationship evidence:

- `pick_candidates.pick_id` has no FK; `settlement_records.pick_id` has
  `settlement_records_pick_id_fkey -> picks.id`.
- Current `picks` has no `is_shadow` column, which the canonical vocabulary permits. This lane uses
  the existing repo's exact pick-source shadow rule (`picks.source = 'shadow'`) and does not
  conflate it with `pick_candidates.shadow_mode`.
- `picks.submission_id` has the production submission FK. A null value is excluded.
- The fixture predicate mirrors `reporting.pick_fixture_reason(metadata, selection, market, source)`
  from migration `20260731000000_utv2_1399_fixture_excluding_reporting_views.sql`.

The pre-implementation sanctioned read-only observation found 1,412 qualifying candidate links
backed by 1,182 qualifying picks. This is historical evidence, not a hard-coded expectation.
See `canonical-reference-observation.json`, `live-schema-columns.json`, and
`rest-relationship-probe.json`.

Read-only credential evidence is in `read-only-grants.json`: the only added grants were `SELECT` on
`public.picks` and `public.settlement_records`. The role is non-login, non-superuser,
`default_transaction_read_only=on`, has no creatable schemas, owns no relations, inherits no roles,
has no callable definer functions, and has zero writable relations.

## Verification

- [x] `pnpm exec tsx --test 'scripts/shadow-scoring-runner.test.ts'`: 25 passed, 0 failed.
- [x] `pnpm type-check`: exit 0.
- [x] `pnpm exec eslint scripts/shadow-scoring-runner.ts scripts/shadow-scoring-runner.test.ts`:
      exit 0.
- [x] `pnpm verify:static`: exit 0. Includes sync/alignment, lint, type-check, build, full `pnpm
    test`, production-post-migration tests, Smart Form verification, command manifest, and
      migration checks. Smart Form browser E2E reported its normal explicit non-run because
      `UNIT_TALK_SMART_FORM_E2E` was not set.
- [ ] `pnpm test:db`: safely refused before writes. Observed output was
      `host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx` and `REFUSED: target identity
    could not be resolved from its URL`. The packet predicted `host=unparseable`; this proof
      records the actual result. Writable proof is deferred to `staging-ci`.
- [ ] `pnpm verify`: the full static half completed successfully, then the writable live-DB half
      safely refused before writes with `host=127.0.0.1 ref=unidentified
      expected=xskgrzbteyqdufktjrjx` (overall exit 1). This is the required truthful local result; the
      exact-HEAD staging CI check must supply the writable proof.
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS; 12 changed files
      and no matching R1-R5 rules.
- [ ] Production Shadow dry-run: local `SUPABASE_URL` and `SHADOW_PARITY_READ_ONLY_KEY` are absent.
      The candidate runner cannot be executed by the current trusted-base workflow, whose
      unmodified-runner guard must remain intact. Run after merge from repaired trusted base.

## Runtime Verification

No writable proof was run on production. No local production credential is available. The live
schema/FK query and grant catalog observations are supported read-only production probes already
captured in this bundle. Writable staging proof, exact-HEAD receipts, and the repaired trusted-base
Shadow report remain CI/post-merge dependencies and are not represented as passes here.

## Model Routing

This session is already the sanctioned `ops:codex-exec` child. It did not recursively invoke
`ops:codex-exec`. The required `model-routing.json` is deliberately not hand-authored: the outer
executor owns the immutable CLI provenance and must persist it after this child exits.

## Merge SHA Binding

Merge SHA: pending merge

PR: https://github.com/griff843/Unit-Talk-v2/pull/1715

Implementation SHA: `7240093fc6c610cb16355aeb313fb1b4d102142a`
