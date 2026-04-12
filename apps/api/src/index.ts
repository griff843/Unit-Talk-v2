import { loadEnvironment } from '@unit-talk/config';
import { createApiServer, createApiRuntimeDependencies } from './server.js';
import { startRecapScheduler } from './recap-scheduler.js';
import { startTrialExpiryScheduler } from './trial-expiry-service.js';
import { runPlayerEnrichmentPass } from './player-enrichment-service.js';
import { runSystemPickScan, loadSystemPickScannerConfig } from './system-pick-scanner.js';
import { runMarketUniverseMaterializer } from './market-universe-materializer.js';
import { runLineMovementDetection, DatabaseLineMovementRepository } from './line-movement-detector.js';
import { runBoardScan } from './board-scan-service.js';
import { runCandidateScoring } from './candidate-scoring-service.js';
import { runRankedSelection } from './ranked-selection-service.js';
import { runBoardConstruction } from './board-construction-service.js';

const SYSTEM_PICK_SCANNER_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MARKET_UNIVERSE_MATERIALIZER_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const LINE_MOVEMENT_DETECTOR_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const BOARD_SCAN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const CANDIDATE_SCORING_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const RANKED_SELECTION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const BOARD_CONSTRUCTION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const defaultPort = 4000;
const port = normalizePort(process.env.PORT);
const environment = loadEnvironment();
const runtime = createApiRuntimeDependencies({ environment });
const server = createApiServer({ runtime });
let stopRecapScheduler: (() => void) | null = null;
let stopTrialExpiryScheduler: (() => void) | null = null;
let enrichmentTimer: ReturnType<typeof setInterval> | null = null;
let systemPickScannerTimer: ReturnType<typeof setInterval> | null = null;
let marketUniverseMaterializerTimer: ReturnType<typeof setInterval> | null = null;
let lineMovementDetectorTimer: ReturnType<typeof setInterval> | null = null;
let boardScanTimer: ReturnType<typeof setInterval> | null = null;
let candidateScoringTimer: ReturnType<typeof setInterval> | null = null;
let rankedSelectionTimer: ReturnType<typeof setInterval> | null = null;
let boardConstructionTimer: ReturnType<typeof setInterval> | null = null;
let shuttingDown = false;

server.listen(port, () => {
  stopRecapScheduler = startRecapScheduler(runtime.repositories);
  stopTrialExpiryScheduler = startTrialExpiryScheduler(
    runtime.repositories.tiers,
    runtime.repositories.audit,
  );

  // Player enrichment: run once on startup, then every 6 hours
  const enrichmentDeps = {
    participants: runtime.repositories.participants,
    runs: runtime.repositories.runs,
  };
  runPlayerEnrichmentPass(enrichmentDeps).catch(() => {});
  enrichmentTimer = setInterval(() => {
    runPlayerEnrichmentPass(enrichmentDeps).catch(() => {});
  }, 6 * 60 * 60 * 1000);

  // System pick scanner: materialize opening player prop lines into market_universe
  // Phase 7B UTV2-495 — retired direct /api/submissions path; now writes to governed upstream
  const scannerConfig = loadSystemPickScannerConfig(environment);
  if (scannerConfig.enabled) {
    const scannerDeps = {
      providerOffers: runtime.repositories.providerOffers,
      participants: runtime.repositories.participants,
      events: runtime.repositories.events,
      marketUniverse: runtime.repositories.marketUniverse,
    };
    runSystemPickScan(scannerDeps, { ...scannerConfig, logger: console }).catch(() => {});
    systemPickScannerTimer = setInterval(() => {
      runSystemPickScan(scannerDeps, { ...scannerConfig, logger: console }).catch(() => {});
    }, SYSTEM_PICK_SCANNER_INTERVAL_MS);
  }

  // Market universe materializer: keep market_universe current from provider_offers
  // Phase 2 UTV2-461 — always runs (no feature flag; shadow_mode is enforced at candidate layer)
  const materializerDeps = {
    providerOffers: runtime.repositories.providerOffers,
    marketUniverse: runtime.repositories.marketUniverse,
  };
  runMarketUniverseMaterializer(materializerDeps, { logger: console }).catch(() => {});
  marketUniverseMaterializerTimer = setInterval(() => {
    runMarketUniverseMaterializer(materializerDeps, { logger: console }).catch(() => {});
  }, MARKET_UNIVERSE_MATERIALIZER_INTERVAL_MS);

  // Line movement detector: runs after materializer on same 5-minute schedule
  // Phase 2 UTV2-462 — in-memory only, no DB writes
  const lineMovementRepo = new DatabaseLineMovementRepository(runtime.repositories.marketUniverse);
  runLineMovementDetection(lineMovementRepo, { logger: console }).catch(() => {});
  lineMovementDetectorTimer = setInterval(() => {
    runLineMovementDetection(lineMovementRepo, { logger: console }).catch(() => {});
  }, LINE_MOVEMENT_DETECTOR_INTERVAL_MS);

  // Board scan: reads market_universe, writes pick_candidates
  // Phase 2 UTV2-463 — gated by SYNDICATE_MACHINE_ENABLED=true (default: false)
  // Runs after materializer on the same 5-min cadence.
  // Hard boundaries: writes ONLY to pick_candidates; pick_id stays NULL;
  // shadow_mode stays true; model fields stay NULL; does NOT create picks.
  const boardScanDeps = {
    marketUniverse: runtime.repositories.marketUniverse,
    pickCandidates: runtime.repositories.pickCandidates,
  };
  runBoardScan(boardScanDeps, { logger: console }).catch(() => {});
  boardScanTimer = setInterval(() => {
    runBoardScan(boardScanDeps, { logger: console }).catch(() => {});
  }, BOARD_SCAN_INTERVAL_MS);

  // Candidate scoring: reads pick_candidates with model_score=NULL, computes and writes scores
  // Phase 3 UTV2-470 — always runs on 5-min cadence after board scan populates candidates
  // Hard invariants: never sets pick_id, never sets shadow_mode=false, never writes to picks
  const scoringDeps = {
    pickCandidates: runtime.repositories.pickCandidates,
    marketUniverse: runtime.repositories.marketUniverse,
  };
  runCandidateScoring(scoringDeps, { logger: console }).catch(() => {});
  candidateScoringTimer = setInterval(() => {
    runCandidateScoring(scoringDeps, { logger: console }).catch(() => {});
  }, CANDIDATE_SCORING_INTERVAL_MS);

  // Ranked selection: deterministically ranks qualified+scored candidates by model_score + tier
  // Phase 4 UTV2-473 — runs after candidate scoring to rank the scored pool
  // Hard invariants: never sets pick_id, never sets shadow_mode=false, no scarcity logic
  const rankingDeps = {
    pickCandidates: runtime.repositories.pickCandidates,
    marketUniverse: runtime.repositories.marketUniverse,
  };
  runRankedSelection(rankingDeps, { logger: console }).catch(() => {});
  rankedSelectionTimer = setInterval(() => {
    runRankedSelection(rankingDeps, { logger: console }).catch(() => {});
  }, RANKED_SELECTION_INTERVAL_MS);

  // Board construction: applies scarcity rules to ranked pool, writes to syndicate_board
  // Phase 4 UTV2-474 — runs after ranked selection on 5-min cadence
  const boardConstructionDeps = {
    pickCandidates: runtime.repositories.pickCandidates,
    marketUniverse: runtime.repositories.marketUniverse,
    syndicateBoard: runtime.repositories.syndicateBoard,
  };
  runBoardConstruction(boardConstructionDeps, { logger: console }).catch(() => {});
  boardConstructionTimer = setInterval(() => {
    runBoardConstruction(boardConstructionDeps, { logger: console }).catch(() => {});
  }, BOARD_CONSTRUCTION_INTERVAL_MS);

  console.log(
    JSON.stringify(
      {
        service: 'api',
        authority: 'api',
        status: 'listening',
        port,
        routes: [
          'GET /health',
          'GET /api/alerts/recent',
          'GET /api/alerts/status',
          'GET /api/shadow-models/summary',
          'POST /api/submissions',
          'POST /api/grading/run',
          'POST /api/recap/post',
        ],
        persistenceMode: runtime.persistenceMode,
        runtimeMode: runtime.runtimeMode,
      },
      null,
      2,
    ),
  );
});

process.once('SIGINT', () => {
  shutdown('SIGINT');
});

process.once('SIGTERM', () => {
  shutdown('SIGTERM');
});

function normalizePort(rawPort: string | undefined) {
  if (!rawPort) {
    return defaultPort;
  }

  const parsed = Number.parseInt(rawPort, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return defaultPort;
  }

  return parsed;
}

function shutdown(signal: 'SIGINT' | 'SIGTERM') {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  stopRecapScheduler?.();
  stopRecapScheduler = null;
  stopTrialExpiryScheduler?.();
  stopTrialExpiryScheduler = null;
  if (enrichmentTimer) { clearInterval(enrichmentTimer); enrichmentTimer = null; }
  if (systemPickScannerTimer) { clearInterval(systemPickScannerTimer); systemPickScannerTimer = null; }
  if (marketUniverseMaterializerTimer) { clearInterval(marketUniverseMaterializerTimer); marketUniverseMaterializerTimer = null; }
  if (lineMovementDetectorTimer) { clearInterval(lineMovementDetectorTimer); lineMovementDetectorTimer = null; }
  if (boardScanTimer) { clearInterval(boardScanTimer); boardScanTimer = null; }
  if (candidateScoringTimer) { clearInterval(candidateScoringTimer); candidateScoringTimer = null; }
  if (rankedSelectionTimer) { clearInterval(rankedSelectionTimer); rankedSelectionTimer = null; }
  if (boardConstructionTimer) { clearInterval(boardConstructionTimer); boardConstructionTimer = null; }

  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => {
    console.error(`Forced shutdown after ${signal}`);
    process.exit(1);
  }, 5_000).unref();
}
