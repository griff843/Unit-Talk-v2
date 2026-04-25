import { createDatabaseClientFromConnection, createServiceRoleDatabaseConnectionConfig } from '@unit-talk/db';
import { loadEnvironment } from '@unit-talk/config';
import { analyzeWeightEffectiveness } from '@unit-talk/domain';

type SportKey = 'MLB' | 'NBA' | 'NHL';
type JsonRecord = Record<string, unknown>;

interface CoverageRow {
  sport: SportKey;
  marketUniverseRows: number;
  withOpening: number;
  withClosing: number;
  withOpenAndClose: number;
  openCloseCoveragePct: number;
}

interface ProofReport {
  issue: 'UTV2-720';
  generatedAt: string;
  provider: 'sgo';
  marketCoverage: CoverageRow[];
  settlements: {
    total: number;
    computedClv: number;
    computedClvPct: number;
    scoredOutcomeSample: number;
  };
  candidateReplay: {
    total: number;
    shadowMode: number;
    linkedToPick: number;
    shadowModePct: number;
  };
  futureLeakage: {
    sampledRows: number;
    violations: number;
  };
  weightEffectiveness: ReturnType<typeof analyzeWeightEffectiveness>;
  verdict: 'pass' | 'fail';
  notes: string[];
}

const SPORTS: SportKey[] = ['MLB', 'NBA', 'NHL'];

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

function readClvPercent(payload: unknown): number | null {
  const record = asRecord(payload);
  const topLevel = readNumber(record['clvPercent']);
  if (topLevel !== null) return topLevel;

  const clvRecord = asRecord(record['clv']);
  const nested = readNumber(clvRecord['clvPercent']);
  if (nested !== null) return nested;

  return readNumber(record['clv']);
}

function readScoreInputs(payload: unknown): {
  edge: number;
  trust: number;
  readiness: number;
  uniqueness: number;
  boardFit: number;
} | null {
  const scoreInputs = asRecord(asRecord(payload)['scoreInputs']);
  const edge = readNumber(scoreInputs['edge']);
  const trust = readNumber(scoreInputs['trust']);
  const readiness = readNumber(scoreInputs['readiness']);
  const uniqueness = readNumber(scoreInputs['uniqueness']);
  const boardFit = readNumber(scoreInputs['boardFit']);

  if (
    edge === null ||
    trust === null ||
    readiness === null ||
    uniqueness === null ||
    boardFit === null
  ) {
    return null;
  }

  return { edge, trust, readiness, uniqueness, boardFit };
}

async function exactCount(
  label: string,
  query: PromiseLike<{ count: number | null; error: { message?: string } | null }>,
): Promise<number> {
  const result = await query;
  if (result.error) {
    throw new Error(`${label}: ${result.error.message ?? 'unknown Supabase error'}`);
  }
  return result.count ?? 0;
}

async function buildReport(): Promise<ProofReport> {
  const connection = createServiceRoleDatabaseConnectionConfig(loadEnvironment());
  const db = createDatabaseClientFromConnection(connection);

  const marketCoverage: CoverageRow[] = [];
  for (const sport of SPORTS) {
    const base = db
      .from('market_universe')
      .select('id', { count: 'exact', head: true })
      .eq('provider_key', 'sgo')
      .eq('sport_key', sport);

    const marketUniverseRows = await exactCount(`${sport} market_universe`, base);
    const withOpening = await exactCount(
      `${sport} opening coverage`,
      db
        .from('market_universe')
        .select('id', { count: 'exact', head: true })
        .eq('provider_key', 'sgo')
        .eq('sport_key', sport)
        .not('opening_line', 'is', null),
    );
    const withClosing = await exactCount(
      `${sport} closing coverage`,
      db
        .from('market_universe')
        .select('id', { count: 'exact', head: true })
        .eq('provider_key', 'sgo')
        .eq('sport_key', sport)
        .not('closing_line', 'is', null),
    );
    const withOpenAndClose = await exactCount(
      `${sport} open and close coverage`,
      db
        .from('market_universe')
        .select('id', { count: 'exact', head: true })
        .eq('provider_key', 'sgo')
        .eq('sport_key', sport)
        .not('opening_line', 'is', null)
        .not('closing_line', 'is', null),
    );

    marketCoverage.push({
      sport,
      marketUniverseRows,
      withOpening,
      withClosing,
      withOpenAndClose,
      openCloseCoveragePct: pct(withOpenAndClose, marketUniverseRows),
    });
  }

  const totalSettlements = await exactCount(
    'settlements total',
    db.from('settlement_records').select('id', { count: 'exact', head: true }),
  );
  const computedClv = await exactCount(
    'settlements computed CLV',
    db
      .from('settlement_records')
      .select('id', { count: 'exact', head: true })
      .filter('payload->>clvStatus', 'eq', 'computed'),
  );

  const { data: settlementRows, error: settlementError } = await db
    .from('settlement_records')
    .select('pick_id,result,payload,created_at')
    .filter('payload->>clvStatus', 'eq', 'computed')
    .order('created_at', { ascending: false })
    .limit(500);
  if (settlementError) {
    throw new Error(`settlement sample: ${settlementError.message}`);
  }

  const pickIds = [...new Set((settlementRows ?? []).map((row) => String(row.pick_id)))];
  const { data: promotionRows, error: promotionError } = await db
    .from('pick_promotion_history')
    .select('pick_id,target,payload,created_at')
    .in('pick_id', pickIds)
    .eq('target', 'best-bets')
    .order('created_at', { ascending: false });
  if (promotionError) {
    throw new Error(`promotion sample: ${promotionError.message}`);
  }

  const latestPromotionByPick = new Map<string, JsonRecord>();
  for (const row of promotionRows ?? []) {
    const pickId = String(row.pick_id);
    if (!latestPromotionByPick.has(pickId)) {
      latestPromotionByPick.set(pickId, asRecord(row.payload));
    }
  }

  const scoredOutcomes = [];
  for (const row of settlementRows ?? []) {
    const clvPercent = readClvPercent(row.payload);
    const scoreInputs = readScoreInputs(latestPromotionByPick.get(String(row.pick_id)));
    if (clvPercent === null || !scoreInputs) {
      continue;
    }
    scoredOutcomes.push({
      scoreInputs,
      clvPercent,
      won: row.result === 'win',
    });
  }

  const candidateTotal = await exactCount(
    'pick candidates total',
    db.from('pick_candidates').select('id', { count: 'exact', head: true }),
  );
  const candidateShadow = await exactCount(
    'pick candidates shadow',
    db
      .from('pick_candidates')
      .select('id', { count: 'exact', head: true })
      .eq('shadow_mode', true),
  );
  const candidateLinked = await exactCount(
    'pick candidates linked',
    db
      .from('pick_candidates')
      .select('id', { count: 'exact', head: true })
      .not('pick_id', 'is', null),
  );

  const { data: closingRows, error: closingError } = await db
    .from('provider_offers')
    .select('provider_event_id,snapshot_at')
    .eq('provider_key', 'sgo')
    .eq('is_closing', true)
    .limit(1_000);
  if (closingError) {
    throw new Error(`future-leakage sample: ${closingError.message}`);
  }

  const eventExternalIds = [
    ...new Set((closingRows ?? []).map((row) => String(row.provider_event_id))),
  ];
  const { data: eventRows, error: eventError } = await db
    .from('events')
    .select('external_id,event_date')
    .in('external_id', eventExternalIds);
  if (eventError) {
    throw new Error(`event sample: ${eventError.message}`);
  }

  const eventDateByExternalId = new Map(
    (eventRows ?? []).map((row) => [String(row.external_id), String(row.event_date)]),
  );
  const futureLeakageViolations = (closingRows ?? []).filter((row) => {
    const eventDate = eventDateByExternalId.get(String(row.provider_event_id));
    // events.event_date currently stores date precision for these historical rows,
    // so this proof can only fail rows whose closing snapshot lands after the
    // event date, not after exact first pitch/puck/tip time.
    return eventDate ? String(row.snapshot_at).slice(0, 10) > eventDate.slice(0, 10) : false;
  }).length;

  const weightEffectiveness = analyzeWeightEffectiveness(scoredOutcomes);
  const notes = [
    'Codex proof only: this reports data sufficiency and replay input shape; it does not declare model trust.',
    'Claude/PM remain responsible for readiness framing and final trust decisions.',
  ];

  const verdict =
    marketCoverage.every((row) => row.withOpenAndClose >= 1_000 && row.openCloseCoveragePct >= 70) &&
    computedClv >= 20 &&
    scoredOutcomes.length >= 20 &&
    candidateShadow >= candidateLinked &&
    futureLeakageViolations === 0
      ? 'pass'
      : 'fail';

  return {
    issue: 'UTV2-720',
    generatedAt: new Date().toISOString(),
    provider: 'sgo',
    marketCoverage,
    settlements: {
      total: totalSettlements,
      computedClv,
      computedClvPct: pct(computedClv, totalSettlements),
      scoredOutcomeSample: scoredOutcomes.length,
    },
    candidateReplay: {
      total: candidateTotal,
      shadowMode: candidateShadow,
      linkedToPick: candidateLinked,
      shadowModePct: pct(candidateShadow, candidateTotal),
    },
    futureLeakage: {
      sampledRows: closingRows?.length ?? 0,
      violations: futureLeakageViolations,
    },
    weightEffectiveness,
    verdict,
    notes,
  };
}

function printHuman(report: ProofReport): void {
  console.log(`UTV2-720 historical SGO CLV validation: ${report.verdict.toUpperCase()}`);
  console.log(`Generated: ${report.generatedAt}`);
  console.log('');
  for (const row of report.marketCoverage) {
    console.log(
      `${row.sport}: ${row.withOpenAndClose}/${row.marketUniverseRows} market_universe rows have both open+close (${row.openCloseCoveragePct}%)`,
    );
  }
  console.log('');
  console.log(
    `Settlements: ${report.settlements.computedClv}/${report.settlements.total} computed CLV (${report.settlements.computedClvPct}%), ${report.settlements.scoredOutcomeSample} with promotion score inputs`,
  );
  console.log(
    `Candidate replay pool: ${report.candidateReplay.total} candidates, ${report.candidateReplay.shadowModePct}% shadow_mode, ${report.candidateReplay.linkedToPick} linked to picks`,
  );
  console.log(
    `Future-leakage sample: ${report.futureLeakage.sampledRows} rows checked, ${report.futureLeakage.violations} closing snapshots after event start`,
  );
  console.log(
    `Weight-effectiveness sample: ${report.weightEffectiveness.sampleSize}, confidence=${report.weightEffectiveness.confidence}`,
  );
}

const json = process.argv.includes('--json');

buildReport()
  .then((report) => {
    if (json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printHuman(report);
    }
    process.exitCode = report.verdict === 'pass' ? 0 : 1;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
