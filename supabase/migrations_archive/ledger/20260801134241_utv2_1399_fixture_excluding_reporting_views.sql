-- UTV2-1399 — fixture-excluding production reporting views
--
-- PROBLEM
--   public.picks is ~93% CI/proof test fixtures accumulated since 2026-04-21.
--   Measured 2026-07-31 against production zfzdnfwdarxucxtaojxm:
--     total picks 107,858 · fixture-marked 100,278 · legitimate 7,580.
--   97.89% of settled stake volume is synthetic (18,278.00 raw vs 385.50 real),
--   so every product analytic that reads the base tables is wrong.
--
-- WHAT THIS MIGRATION DOES
--   Creates schema `reporting` containing ONE classifier function and a set of
--   read-only views that exclude conclusively marked fixtures.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   No DELETE. No UPDATE. No TRUNCATE. No ALTER of any base table. No column
--   drops. No row is mutated or removed. Deleting fixture rows is deliberately
--   NOT authorized and is tracked separately as an exact-ID packet.
--
-- REVERSIBILITY
--   Everything lives inside schema `reporting`. `DROP SCHEMA reporting CASCADE`
--   (see the .down.sql) restores prior reporting behaviour exactly, because no
--   object outside that schema is touched. Consumers that read public.* are
--   completely unaffected either way.
--
-- CLASSIFIER PROVENANCE
--   The predicates below are the metadata markers validated against production
--   in the fixture-cleanup packet (classifier.sql / false-positive-audit.md),
--   extended by UTV2-1399 to close the documented false-negative gap. They are
--   deterministic self-identifying markers emitted by the proof harness itself:
--   a `proof_issue` / `proofRunId` metadata key, a `db-smoke-` event name, a
--   `UTV2-<n>` selection prefix, or a per-run `utv2-<issue>-<runid>` tag.
--
--   Classification is NEVER by `source` alone. `smart-form`,
--   `system-pick-scanner`, `model-driven`, `alert-agent` and `api` are all BOTH
--   legitimate production source names AND fixture source names. A naive
--   source-based exclusion was measured to wrongly drop 6,462 of the 7,580
--   real picks (85.2%). Only `t1-proof` and `canary-proof` are purely synthetic
--   source names and used as markers.
--
-- THREE-VALUED-LOGIC HAZARD (measured: 411 rows)
--   `metadata->>'eventName'` is SQL NULL when the key is absent, and
--   `false OR NULL` is NULL — so a bare OR-chain predicate returns NULL, not
--   false, for 411 of 107,858 rows. `WHERE NOT (predicate)` would silently drop
--   those rows from BOTH the excluded and retained sets. This migration avoids
--   the trap structurally: the classifier is a CASE expression returning either
--   a reason string or NULL, and retention is `IS NULL` / exclusion is
--   `IS NOT NULL`, which are total and mutually exclusive by construction.

BEGIN;

CREATE SCHEMA IF NOT EXISTS reporting;

COMMENT ON SCHEMA reporting IS
  'UTV2-1399. Read-only, fixture-excluding reporting surface over public.*. '
  'Contains only views and one immutable classifier function; owns no data. '
  'Safe to DROP SCHEMA reporting CASCADE — no base table depends on it.';

CREATE OR REPLACE FUNCTION reporting.pick_fixture_reason(
  p_metadata  jsonb,
  p_selection text,
  p_market    text,
  p_source    text
) RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_metadata ? 'proof_issue'                            THEN 'proof_issue_metadata'
    WHEN p_metadata ? 'proofRunId'                             THEN 'proof_run_id_metadata'
    WHEN p_metadata->>'eventName' LIKE 'db-smoke-%'             THEN 'db_smoke_event'
    WHEN p_metadata->>'eventName' ~* '^utv2[ _-]'               THEN 'utv2_event_name'
    WHEN p_selection ~* '^UTV2[ _-]'                            THEN 'utv2_selection_prefix'
    WHEN p_selection ~* '\[utv2-[0-9]+'                         THEN 'utv2_run_tag_selection'
    WHEN p_selection ~* '\(utv2-[0-9]+'                         THEN 'utv2_run_tag_selection'
    WHEN p_source IN ('t1-proof','canary-proof')                THEN 'proof_only_source'
    WHEN p_metadata->>'eventName' ~* 'Command Center QA'         THEN 'command_center_qa'
    WHEN p_selection ~* 'STAFF-ONLY DRY RUN'                     THEN 'staff_only_dry_run'
    WHEN lower(p_selection) IN ('test','foo','bar','dummy','sample')
                                                                 THEN 'placeholder_selection'
    WHEN p_market = 'test'                                       THEN 'placeholder_market'
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION reporting.pick_fixture_reason(jsonb, text, text, text) IS
  'UTV2-1399. Returns NULL for a legitimate pick or a stable reason code for a '
  'test fixture. Deterministic metadata markers only — never source alone. '
  'Measured 2026-07-31: 100,278 excluded / 7,580 retained of 107,858.';

CREATE OR REPLACE VIEW reporting.picks AS
SELECT
  p.id, p.submission_id, p.source, p.market, p.market_type_id, p.selection,
  p.line, p.odds, p.stake_units, p.confidence, p.status, p.approval_status,
  p.promotion_status, p.promotion_target, p.promotion_score, p.promotion_reason,
  p.promotion_version, p.promotion_decided_at, p.promotion_decided_by,
  p.capper_id, p.player_id, p.participant_id, p.sport_id, p.idempotency_key,
  p.metadata, p.posted_at, p.settled_at, p.created_at, p.updated_at
FROM public.picks p
WHERE reporting.pick_fixture_reason(p.metadata, p.selection, p.market, p.source) IS NULL;

COMMENT ON VIEW reporting.picks IS
  'UTV2-1399. public.picks with conclusively marked CI/proof fixtures excluded. '
  'Measured 2026-07-31: 7,580 rows retained of 107,858.';

CREATE OR REPLACE VIEW reporting.excluded_picks AS
SELECT
  p.id, p.submission_id, p.source, p.market, p.selection, p.status,
  p.stake_units, p.created_at,
  reporting.pick_fixture_reason(p.metadata, p.selection, p.market, p.source) AS fixture_reason
FROM public.picks p
WHERE reporting.pick_fixture_reason(p.metadata, p.selection, p.market, p.source) IS NOT NULL;

COMMENT ON VIEW reporting.excluded_picks IS
  'UTV2-1399. The complement of reporting.picks, carrying the exclusion reason '
  'so every removal is individually auditable. Nothing is deleted — these rows '
  'remain fully present in public.picks.';

CREATE OR REPLACE VIEW reporting.submissions AS
SELECT
  s.id, s.external_id, s.source, s.submitted_by, s.payload, s.status,
  s.received_at, s.created_at, s.updated_at
FROM public.submissions s
WHERE EXISTS (SELECT 1 FROM reporting.picks rp WHERE rp.submission_id = s.id);

COMMENT ON VIEW reporting.submissions IS
  'UTV2-1399. Submissions owning at least one non-fixture pick. '
  'Measured 2026-07-31: 7,580 rows retained of 107,428.';

CREATE OR REPLACE VIEW reporting.settlement_records AS
SELECT
  sr.id, sr.pick_id, sr.result, sr.source, sr.confidence, sr.settled_by,
  sr.payload, sr.status, sr.stake_units, sr.corrects_id, sr.evidence_ref,
  sr.notes, sr.review_reason, sr.settled_at, sr.created_at
FROM public.settlement_records sr
WHERE EXISTS (SELECT 1 FROM reporting.picks rp WHERE rp.id = sr.pick_id);

COMMENT ON VIEW reporting.settlement_records IS
  'UTV2-1399. Settlement records whose pick survives fixture exclusion. '
  'Measured 2026-07-31: 1,573 rows retained of 37,496.';

CREATE OR REPLACE VIEW reporting.contamination_summary AS
SELECT
  (SELECT count(*) FROM public.picks)                    AS picks_raw,
  (SELECT count(*) FROM reporting.picks)                 AS picks_retained,
  (SELECT count(*) FROM reporting.excluded_picks)        AS picks_excluded,
  (SELECT count(*) FROM public.submissions)              AS submissions_raw,
  (SELECT count(*) FROM reporting.submissions)           AS submissions_retained,
  (SELECT count(*) FROM public.settlement_records)       AS settlements_raw,
  (SELECT count(*) FROM reporting.settlement_records)    AS settlements_retained,
  (SELECT COALESCE(sum(stake_units), 0) FROM public.picks WHERE status = 'settled')
                                                         AS settled_stake_raw,
  (SELECT COALESCE(sum(stake_units), 0) FROM reporting.picks WHERE status = 'settled')
                                                         AS settled_stake_retained;

COMMENT ON VIEW reporting.contamination_summary IS
  'UTV2-1399. Single-row observability of fixture contamination in the base '
  'tables. picks_retained + picks_excluded always equals picks_raw.';

DO $$
DECLARE
  v_raw      bigint;
  v_retained bigint;
  v_excluded bigint;
BEGIN
  SELECT count(*) INTO v_raw      FROM public.picks;
  SELECT count(*) INTO v_retained FROM reporting.picks;
  SELECT count(*) INTO v_excluded FROM reporting.excluded_picks;

  IF v_retained + v_excluded <> v_raw THEN
    RAISE EXCEPTION
      'UTV2-1399 partition check failed: retained(%) + excluded(%) <> raw(%). '
      'The classifier is not total — likely a three-valued-logic regression.',
      v_retained, v_excluded, v_raw;
  END IF;

  IF v_raw > 0 AND v_retained = 0 THEN
    RAISE EXCEPTION
      'UTV2-1399 sanity check failed: public.picks has % rows but '
      'reporting.picks is empty. A view that excludes every real pick is worse '
      'than the contamination it removes.', v_raw;
  END IF;

  RAISE NOTICE 'UTV2-1399: reporting views created. raw=% retained=% excluded=%',
    v_raw, v_retained, v_excluded;
END
$$;

COMMIT;
;
