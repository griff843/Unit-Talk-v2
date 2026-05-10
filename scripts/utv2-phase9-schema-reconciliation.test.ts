import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cronHasPhase9LifecycleCalls,
  evaluateVersionChecks,
  extractMissingVersions,
} from './utv2-phase9-schema-reconciliation.js';

test('extractMissingVersions returns versions absent from the applied ledger', () => {
  assert.deepStrictEqual(
    extractMissingVersions(
      ['202605020001', '202605020002', '202605090001'],
      ['202605020001'],
    ),
    ['202605020002', '202605090001'],
  );
});

test('cronHasPhase9LifecycleCalls requires both summarize and partition-drop calls', () => {
  assert.equal(
    cronHasPhase9LifecycleCalls(`
      SELECT * FROM public.summarize_provider_offer_history_partition((timezone('utc', now()) - INTERVAL '8 days')::date);
      SELECT * FROM public.drop_old_provider_offer_history_partitions(7);
    `),
    true,
  );
  assert.equal(
    cronHasPhase9LifecycleCalls(`
      SELECT * FROM public.prune_provider_offers_bounded(7, 5000, 20);
    `),
    false,
  );
});

test('evaluateVersionChecks marks the low-risk slice semantically live when checks pass', () => {
  const checks = evaluateVersionChecks({
    ledger: {
      total: 90,
      maxVersion: '202604300003',
      appliedVersions: [],
    },
    semantic: {
      experimentLedgerConstraintPresent: true,
      experimentLedgerConstraintDefinition:
        "CHECK (run_type = ANY (ARRAY['training'::text, 'eval'::text, 'backtest'::text, 'calibration'::text, 'shadow_comparison'::text]))",
      marketUniverseClosingBackfillGapCount: 0,
      marketUniverseClosingEvidenceCount: 42,
      sgoReplayCoverageViewPresent: true,
      staleMlbAliasCount: 0,
      mlbGameTotalAliasCorrect: true,
      mlbNullMarketTypeCount: 0,
      mlbNullMarketTypeKnownStakeCount: 0,
      mlbNullMarketTypeNullStakeCount: 0,
      settlementProfitLossGapCount: 0,
      canonicalMarketKeyGapCount: 0,
      closingMaterializerIndexes: [
        'idx_market_universe_provider_event_id',
        'idx_provider_offers_closing_snapshot_id_desc',
      ],
      providerOffersBoundedFn: true,
      providerOfferHistoryTable: true,
      providerOfferCurrentTable: true,
      providerOfferCurrentMergeFn: true,
      providerOfferCurrentOpeningFn: true,
      pickCandidatesSportKeyColumn: true,
      pickCandidatesSportKeyIndex: true,
      unresolvedBoardCandidateLinks: 0,
      linkedBoardCandidateRows: 285,
      providerOfferHistoryDropFn: true,
      providerOfferLineSnapshotsTable: true,
      providerOfferLineSnapshotsSummaryFn: true,
      providerOfferLineSnapshotsIndexes: [
        'provider_offer_line_snapshots_bk_idx',
        'provider_offer_line_snapshots_date_idx',
        'provider_offer_line_snapshots_provider_date_idx',
      ],
      stakeConstraintPresent: true,
      stakeConstraintValidated: false,
      stakeConstraintDefinition: 'CHECK (...) NOT VALID',
      ownershipColumns: [
        'active_state',
        'model_registry_id',
        'ownership_timestamp',
        'registry_entity_type',
        'scoring_run_id',
        'source_type_compatibility',
      ],
      ownershipIndexes: [
        'model_registry_active_scope_idx',
        'model_registry_entity_scope_idx',
        'model_registry_source_type_compatibility_idx',
        'pick_candidates_model_registry_id_idx',
        'pick_candidates_ownership_timestamp_idx',
        'pick_candidates_pick_ownership_idx',
        'pick_candidates_scoring_run_id_idx',
      ],
      ownershipNulls: {
        registryEntityType: 0,
        sourceTypeCompatibility: 0,
        activeState: 0,
      },
      cronJob: {
        jobname: 'nightly-retention-prune',
        schedule: '0 3 * * *',
        command: `
          SELECT * FROM public.summarize_provider_offer_history_partition((timezone('utc', now()) - INTERVAL '8 days')::date);
          SELECT * FROM public.drop_old_provider_offer_history_partitions(7);
        `,
      },
    },
  });

  const lowRisk = checks.filter(
    (check) => check.version === '202605020001' || check.version === '202605070001',
  );

  assert.equal(lowRisk.length, 2);
  for (const check of lowRisk) {
    assert.equal(check.readyForLedger, true);
    assert.equal(check.semanticallyLive, true);
  }
});
