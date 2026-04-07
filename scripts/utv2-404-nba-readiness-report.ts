import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

type PickAuditRow = {
  id: string;
  market: string;
  metadata: Record<string, unknown> | null;
};

type SettlementAuditRow = {
  pick_id: string;
  result: 'win' | 'loss' | 'push' | null;
  payload: Record<string, unknown> | null;
};

type ProviderOfferAuditRow = {
  provider_key: string;
  provider_market_key: string;
  provider_event_id: string;
  provider_participant_id: string | null;
  bookmaker_key: string | null;
  line: number | null;
  is_opening: boolean | null;
  is_closing: boolean | null;
  snapshot_at: string | null;
};

type ReadinessSnapshot = {
  generatedAt: string;
  counts: {
    usableSettledOutcomeCount: number;
    clvBackedOutcomeCount: number;
    gameMarketRowCount: number;
    postContractEligibleGameMarketRowCount: number;
    excludedArtifactGameMarketRowCount: number;
    liveBookmakerKeyedGameMarketRowCount: number;
    closingRowCount: number;
    openCloseRowCount: number;
    sharpReferenceRowCount: number;
  };
};

type SnapshotComparison = {
  label: string;
  snapshot: ReadinessSnapshot;
  deltas: Record<keyof ReadinessSnapshot['counts'], number>;
  isUnchanged: boolean;
};

const SHARP_BOOKS = new Set(['pinnacle', 'circa']);
const SNAPSHOT_DIR = path.resolve(process.cwd(), 'artifacts', 'utv2-404');
// UTV2-386 made bookmaker-keyed SGO rows part of the live contract; older rows remain inventory only.
const BOOKMAKER_CONTRACT_CUTOFF = '2026-04-04T00:00:00.000Z';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function readNumber(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function shouldWriteSnapshot(args: string[]) {
  return args.includes('--write-snapshot');
}

function createSnapshotFileName(isoTimestamp: string) {
  return `nba-readiness-${isoTimestamp.replaceAll(':', '-').replaceAll('.', '-')}.json`;
}

function isSgoNormalizedGameMarketOffer(offer: ProviderOfferAuditRow) {
  if (offer.provider_key !== 'sgo') {
    return false;
  }

  if (offer.provider_participant_id !== null) {
    return false;
  }

  return (
    offer.provider_market_key === 'moneyline' ||
    /-all-game-(ml|sp|ou)$/i.test(offer.provider_market_key)
  );
}

async function readExistingSnapshots() {
  try {
    const entries = await readdir(SNAPSHOT_DIR, { withFileTypes: true });
    const snapshots = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map(async (entry) => {
          const filePath = path.join(SNAPSHOT_DIR, entry.name);
          const raw = await readFile(filePath, 'utf8');
          const parsed = JSON.parse(raw) as ReadinessSnapshot;
          return {
            path: filePath,
            snapshot: parsed,
          };
        }),
    );

    return snapshots
      .filter((entry) => Boolean(Date.parse(entry.snapshot.generatedAt)))
      .sort(
        (left, right) =>
          Date.parse(left.snapshot.generatedAt) - Date.parse(right.snapshot.generatedAt),
      );
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function buildDeltaRecord(current: ReadinessSnapshot, prior: ReadinessSnapshot) {
  const priorCounts = {
    usableSettledOutcomeCount: prior.counts.usableSettledOutcomeCount ?? 0,
    clvBackedOutcomeCount: prior.counts.clvBackedOutcomeCount ?? 0,
    gameMarketRowCount: prior.counts.gameMarketRowCount ?? 0,
    postContractEligibleGameMarketRowCount:
      prior.counts.postContractEligibleGameMarketRowCount ?? 0,
    excludedArtifactGameMarketRowCount:
      prior.counts.excludedArtifactGameMarketRowCount ?? 0,
    liveBookmakerKeyedGameMarketRowCount:
      prior.counts.liveBookmakerKeyedGameMarketRowCount ?? 0,
    closingRowCount: prior.counts.closingRowCount ?? 0,
    openCloseRowCount: prior.counts.openCloseRowCount ?? 0,
    sharpReferenceRowCount: prior.counts.sharpReferenceRowCount ?? 0,
  };

  return {
    usableSettledOutcomeCount:
      current.counts.usableSettledOutcomeCount - priorCounts.usableSettledOutcomeCount,
    clvBackedOutcomeCount:
      current.counts.clvBackedOutcomeCount - priorCounts.clvBackedOutcomeCount,
    gameMarketRowCount: current.counts.gameMarketRowCount - priorCounts.gameMarketRowCount,
    postContractEligibleGameMarketRowCount:
      current.counts.postContractEligibleGameMarketRowCount -
      priorCounts.postContractEligibleGameMarketRowCount,
    excludedArtifactGameMarketRowCount:
      current.counts.excludedArtifactGameMarketRowCount -
      priorCounts.excludedArtifactGameMarketRowCount,
    liveBookmakerKeyedGameMarketRowCount:
      current.counts.liveBookmakerKeyedGameMarketRowCount -
      priorCounts.liveBookmakerKeyedGameMarketRowCount,
    closingRowCount: current.counts.closingRowCount - priorCounts.closingRowCount,
    openCloseRowCount: current.counts.openCloseRowCount - priorCounts.openCloseRowCount,
    sharpReferenceRowCount:
      current.counts.sharpReferenceRowCount - priorCounts.sharpReferenceRowCount,
  };
}

function isDeltaRecordUnchanged(deltas: Record<keyof ReadinessSnapshot['counts'], number>) {
  return Object.values(deltas).every((value) => value === 0);
}

function buildComparison(
  label: string,
  current: ReadinessSnapshot,
  prior: ReadinessSnapshot | null,
) {
  if (!prior) {
    return null;
  }

  const deltas = buildDeltaRecord(current, prior);
  return {
    label,
    snapshot: prior,
    deltas,
    isUnchanged: isDeltaRecordUnchanged(deltas),
  } satisfies SnapshotComparison;
}

function findSevenDaySnapshot(
  snapshots: Array<{ path: string; snapshot: ReadinessSnapshot }>,
  currentGeneratedAt: string,
) {
  const threshold = Date.parse(currentGeneratedAt) - 7 * 24 * 60 * 60 * 1000;
  return [...snapshots]
    .reverse()
    .find((entry) => Date.parse(entry.snapshot.generatedAt) <= threshold) ?? null;
}

function printComparison(comparison: SnapshotComparison | null) {
  if (!comparison) {
    return;
  }

  console.log(`\n--- ${comparison.label} ---`);
  console.log(`comparisonGeneratedAt=${comparison.snapshot.generatedAt}`);
  console.log(`usableSettledOutcomeCountDelta=${comparison.deltas.usableSettledOutcomeCount}`);
  console.log(`clvBackedOutcomeCountDelta=${comparison.deltas.clvBackedOutcomeCount}`);
  console.log(`gameMarketRowCountDelta=${comparison.deltas.gameMarketRowCount}`);
  console.log(
    `postContractEligibleGameMarketRowCountDelta=${comparison.deltas.postContractEligibleGameMarketRowCount}`,
  );
  console.log(
    `excludedArtifactGameMarketRowCountDelta=${comparison.deltas.excludedArtifactGameMarketRowCount}`,
  );
  console.log(
    `liveBookmakerKeyedGameMarketRowCountDelta=${comparison.deltas.liveBookmakerKeyedGameMarketRowCount}`,
  );
  console.log(`closingRowCountDelta=${comparison.deltas.closingRowCount}`);
  console.log(`openCloseRowCountDelta=${comparison.deltas.openCloseRowCount}`);
  console.log(`sharpReferenceRowCountDelta=${comparison.deltas.sharpReferenceRowCount}`);
  console.log(`stagnant=${comparison.isUnchanged}`);
}

async function main() {
  const writeSnapshot = shouldWriteSnapshot(process.argv.slice(2));
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const existingSnapshots = await readExistingSnapshots();

  const { data: picksRows, error: picksError } = await db
    .from('picks')
    .select('id,market,metadata')
    .filter('metadata->>sport', 'eq', 'NBA')
    .not('market', 'like', '% - %');

  if (picksError) {
    throw new Error(`picks query failed: ${picksError.message}`);
  }

  const picks = (picksRows ?? []) as PickAuditRow[];
  const pickIds = picks.map((pick) => pick.id);

  let settlements: SettlementAuditRow[] = [];
  if (pickIds.length > 0) {
    const { data: settlementRows, error: settlementError } = await db
      .from('settlement_records')
      .select('pick_id,result,payload')
      .in('pick_id', pickIds);

    if (settlementError) {
      throw new Error(`settlement_records query failed: ${settlementError.message}`);
    }

    settlements = (settlementRows ?? []) as SettlementAuditRow[];
  }

  const settlementByPickId = new Map(settlements.map((row) => [row.pick_id, row]));
  let usableSettledOutcomeCount = 0;
  let clvBackedOutcomeCount = 0;

  for (const pick of picks) {
    const settlement = settlementByPickId.get(pick.id);
    if (!settlement?.result || settlement.result === 'push') {
      continue;
    }

    usableSettledOutcomeCount += 1;

    const metadata = asRecord(pick.metadata);
    const payload = asRecord(settlement.payload);
    const clvPercent =
      readNumber(payload, 'clvPercent') ??
      readNumber(metadata, 'clvPercent') ??
      null;

    if (clvPercent != null) {
      clvBackedOutcomeCount += 1;
    }
  }

  const { data: offerRows, error: offerError } = await db
    .from('provider_offers')
    .select(
      'provider_key,provider_market_key,provider_event_id,provider_participant_id,bookmaker_key,line,is_opening,is_closing,snapshot_at',
    )
    .eq('sport_key', 'NBA');

  if (offerError) {
    throw new Error(`provider_offers query failed: ${offerError.message}`);
  }

  const offers = (offerRows ?? []) as ProviderOfferAuditRow[];
  const gameMarketRows = offers.filter(isSgoNormalizedGameMarketOffer);
  const postContractEligibleGameMarketRows = gameMarketRows.filter((offer) => {
    if (!offer.snapshot_at) {
      return false;
    }

    return offer.snapshot_at >= BOOKMAKER_CONTRACT_CUTOFF;
  });
  const excludedArtifactGameMarketRows =
    gameMarketRows.length - postContractEligibleGameMarketRows.length;
  const liveBookmakerKeyedGameMarketRowCount = postContractEligibleGameMarketRows.filter(
    (offer) => offer.bookmaker_key !== null,
  ).length;
  const closingRowCount = postContractEligibleGameMarketRows.filter(
    (offer) => offer.is_closing === true,
  ).length;

  const groupedGameMarkets = new Map<string, ProviderOfferAuditRow[]>();
  for (const offer of postContractEligibleGameMarketRows) {
    const key = [
      offer.provider_event_id,
      offer.provider_market_key,
      offer.provider_participant_id ?? 'all',
    ].join('|');
    const existing = groupedGameMarkets.get(key) ?? [];
    existing.push(offer);
    groupedGameMarkets.set(key, existing);
  }

  let openCloseRowCount = 0;
  let sharpReferenceRowCount = 0;

  for (const rows of groupedGameMarkets.values()) {
    const hasOpen = rows.some((row) => row.is_opening && row.line != null);
    const hasClose = rows.some((row) => row.is_closing && row.line != null);
    if (hasOpen && hasClose) {
      openCloseRowCount += 1;
    }

    const hasSharpReference = rows.some((row) => {
      const book = (row.bookmaker_key ?? '').toLowerCase();
      return SHARP_BOOKS.has(book) && row.line != null;
    });

    if (hasSharpReference) {
      sharpReferenceRowCount += 1;
    }
  }

  const snapshot: ReadinessSnapshot = {
    generatedAt: new Date().toISOString(),
    counts: {
      usableSettledOutcomeCount,
      clvBackedOutcomeCount,
      gameMarketRowCount: gameMarketRows.length,
      postContractEligibleGameMarketRowCount: postContractEligibleGameMarketRows.length,
      excludedArtifactGameMarketRowCount: excludedArtifactGameMarketRows,
      liveBookmakerKeyedGameMarketRowCount,
      closingRowCount,
      openCloseRowCount,
      sharpReferenceRowCount,
    },
  };

  console.log('=== UTV2-404: NBA Readiness Report ===');
  console.log(`generatedAt=${snapshot.generatedAt}`);
  console.log(`usableSettledOutcomeCount=${snapshot.counts.usableSettledOutcomeCount}`);
  console.log(`clvBackedOutcomeCount=${snapshot.counts.clvBackedOutcomeCount}`);
  console.log(`gameMarketRowCount=${snapshot.counts.gameMarketRowCount}`);
  console.log(
    `postContractEligibleGameMarketRowCount=${snapshot.counts.postContractEligibleGameMarketRowCount}`,
  );
  console.log(
    `excludedArtifactGameMarketRowCount=${snapshot.counts.excludedArtifactGameMarketRowCount}`,
  );
  console.log(
    `liveBookmakerKeyedGameMarketRowCount=${snapshot.counts.liveBookmakerKeyedGameMarketRowCount}`,
  );
  console.log(`closingRowCount=${snapshot.counts.closingRowCount}`);
  console.log(`openCloseRowCount=${snapshot.counts.openCloseRowCount}`);
  console.log(`sharpReferenceRowCount=${snapshot.counts.sharpReferenceRowCount}`);

  const latestComparison = buildComparison(
    'Delta Vs Latest Snapshot',
    snapshot,
    existingSnapshots.at(-1)?.snapshot ?? null,
  );
  const sevenDayComparison = buildComparison(
    'Delta Vs 7-Day Snapshot',
    snapshot,
    findSevenDaySnapshot(existingSnapshots, snapshot.generatedAt)?.snapshot ?? null,
  );

  printComparison(latestComparison);
  printComparison(sevenDayComparison);

  if (!writeSnapshot) {
    return;
  }

  await mkdir(SNAPSHOT_DIR, { recursive: true });
  const outputPath = path.join(SNAPSHOT_DIR, createSnapshotFileName(snapshot.generatedAt));
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(`snapshotPath=${outputPath}`);
}

main().catch((error) => {
  console.error('UTV2-404 readiness report failed:', error);
  process.exit(1);
});
