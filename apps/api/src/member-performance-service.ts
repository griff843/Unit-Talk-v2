import { createHash } from 'node:crypto';
import {
  readHumanCapperDeliveryAuthorization,
  readPinnedDeliveryDestination,
  readSmartFormDistributionMode,
  isMemberVisibleDeliveryAudience,
} from '@unit-talk/contracts';
import type {
  PickRecord,
  ReceiptRecord,
  RepositoryBundle,
} from '@unit-talk/db';
import {
  aggregateMemberPerformance,
  resolvePublicPerformanceSettlement,
  type MemberPerformanceOptions,
  type PublicPerformanceRecord,
} from '@unit-talk/domain';

const MAX_PICKS = 50_000;
const MAX_PUBLIC_CANDIDATES = 10_000;
const MAX_PROVENANCE_ROWS = 20_000;
const OFFICIAL_TARGET = 'discord:official-picks';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** A fingerprint is internal evidence, never part of the public response. */
function fingerprint(value: unknown): string {
  function ordered(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(ordered);
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, ordered(child)]),
      );
    }
    return input;
  }
  return createHash('sha256')
    .update(JSON.stringify(ordered(value)))
    .digest('hex');
}

function isCandidate(pick: PickRecord): boolean {
  const metadata = record(pick.metadata);
  if (!isMemberVisibleDeliveryAudience(metadata)) return false;
  if (
    !['smart-form', 'alert-agent', 'api', 'discord', 'discord-bot'].includes(
      pick.source,
    )
  )
    return false;
  if (readSmartFormDistributionMode(metadata) !== 'delivery-eligible')
    return false;
  if (readHumanCapperDeliveryAuthorization(metadata)?.decision !== 'authorized')
    return false;
  // Explicit test/private provenance always overrides an otherwise official-looking row.
  if (
    [
      'fixture',
      'isFixture',
      'simulation',
      'isSimulation',
      'testRun',
      'isTest',
      'internal',
      'private',
      'isPrivate',
    ].some((key) => metadata[key] === true)
  )
    return false;
  if (
    ['proof_issue', 'proof_fixture_id', 'proof_script', 'test_key'].some(
      (key) => metadata[key] != null,
    )
  )
    return false;
  if (
    typeof metadata['eventName'] === 'string' &&
    /^(system generated|unique event|live test|guard test|board.*test|test event|proof)/i.test(
      metadata['eventName'],
    )
  )
    return false;
  if (metadata['visibility'] != null && metadata['visibility'] !== 'public')
    return false;
  if (metadata['runtimeMode'] != null && metadata['runtimeMode'] !== 'live')
    return false;
  return true;
}

async function readPopulation(
  repositories: RepositoryBundle,
): Promise<PickRecord[]> {
  // The approved repository implementation owns complete, count-checked
  // pagination. Requesting the full population avoids an out-of-range final
  // offset request, which PostgREST can reject rather than returning [].
  const rows = await repositories.picks.listByLifecycleStates([
    'settled',
    'voided',
  ]);
  if (rows.length > MAX_PICKS)
    throw new Error('Performance population exceeds read budget');
  const ids = new Set<string>();
  let previous: PickRecord | undefined;
  for (const pick of rows) {
    if (
      !pick.id ||
      ids.has(pick.id) ||
      !Number.isFinite(Date.parse(pick.created_at)) ||
      (pick.status !== 'settled' && pick.status !== 'voided')
    ) {
      throw new Error('Performance population is inconsistent');
    }
    if (
      previous &&
      (pick.created_at < previous.created_at ||
        (pick.created_at === previous.created_at && pick.id <= previous.id))
    ) {
      throw new Error('Performance population ordering is inconsistent');
    }
    ids.add(pick.id);
    previous = pick;
  }
  return rows;
}

async function readSnapshot(repositories: RepositoryBundle) {
  const picks = await readPopulation(repositories);
  const candidates = picks.filter(isCandidate);
  if (candidates.length > MAX_PUBLIC_CANDIDATES)
    throw new Error('Performance provenance exceeds read budget');
  const records: PublicPerformanceRecord[] = [];
  const evidence: unknown[] = [picks];
  let provenanceRows = 0;
  // Bounded concurrency: neither a long history nor user-selected filters can
  // create unbounded parallel database requests.
  for (let start = 0; start < candidates.length; start += 8) {
    const batch = await Promise.all(
      candidates.slice(start, start + 8).map(async (pick) => {
        const outbox = await repositories.outbox.listByPickId(pick.id);
        provenanceRows += outbox.length;
        if (provenanceRows > MAX_PROVENANCE_ROWS) {
          throw new Error('Performance delivery history exceeds read budget');
        }
        if (
          new Set(outbox.map((row) => row.id)).size !== outbox.length ||
          outbox.some((row) => row.pick_id !== pick.id)
        ) {
          throw new Error('Performance delivery history is inconsistent');
        }
        const deliveries = outbox.filter(
          (row) => row.target === OFFICIAL_TARGET,
        );
        if (!isMemberVisibleDeliveryAudience(pick.metadata, outbox.map((row) => row.payload))) {
          return { evidence: [pick.id, outbox], performance: null };
        }
        const receipts: Array<ReceiptRecord | null> = [];
        for (
          let receiptStart = 0;
          receiptStart < deliveries.length;
          receiptStart += 8
        ) {
          receipts.push(
            ...(await Promise.all(
              deliveries
                .slice(receiptStart, receiptStart + 8)
                .map((row) =>
                  repositories.receipts.findLatestByOutboxId(
                    row.id,
                    'discord.message',
                  ),
                ),
            )),
          );
        }
        const delivered = deliveries.some((row, index) => {
          const receipt = receipts[index];
          const payload = record(receipt?.payload);
          const pin = readPinnedDeliveryDestination(row.payload);
          return (
            receipt?.outbox_id === row.id &&
            receipt.receipt_type === 'discord.message' &&
            receipt.status === 'sent' &&
            typeof receipt.channel === 'string' &&
            /^\d{16,22}$/.test(receipt.channel) &&
            typeof receipt.external_id === 'string' &&
            /^\d{16,22}$/.test(receipt.external_id) &&
            payload['adapter'] === 'discord' &&
            payload['dryRun'] === false &&
            payload['target'] === OFFICIAL_TARGET &&
            payload['outboxId'] === row.id &&
            payload['messageId'] === receipt.external_id &&
            payload['channelId'] === receipt.channel &&
            pin !== null &&
            pin.channelId === receipt.channel &&
            pin.capperId === pick.capper_id &&
            payload['capperId'] === pin.capperId &&
            payload['guildId'] === pin.guildId &&
            payload['route'] === 'capper-pinned'
          );
        });
        const baseEvidence: unknown[] = [pick.id, outbox, receipts];
        if (!delivered) {
          // A posted/sent candidate with missing or ambiguous receipt evidence
          // cannot safely become either a public result or a silent omission.
          if (
            pick.posted_at !== null ||
            receipts.some((receipt) => receipt !== null)
          ) {
            throw new Error(
              'Performance public delivery cannot be established',
            );
          }
          return { evidence: baseEvidence, performance: null };
        }
        const authorization = readHumanCapperDeliveryAuthorization(
          record(pick.metadata),
        );
        if (
          !pick.capper_id ||
          authorization?.capperId !== pick.capper_id ||
          !repositories.cappers
        ) {
          throw new Error(
            'Performance canonical attribution cannot be established',
          );
        }
        const [capper, settlements] = await Promise.all([
          repositories.cappers.findById(pick.capper_id),
          repositories.settlements.listByPick(pick.id),
        ]);
        if (
          !capper ||
          capper.id !== pick.capper_id ||
          !capper.display_name.trim()
        ) {
          throw new Error('Performance canonical capper is unavailable');
        }
        const settlement = resolvePublicPerformanceSettlement(
          pick.id,
          settlements,
        );
        if (
          pick.status === 'voided' &&
          settlement.result !== 'void' &&
          settlement.result !== 'cancelled'
        ) {
          throw new Error('Performance lifecycle and settlement disagree');
        }
        if (
          pick.status === 'settled' &&
          (!pick.settled_at || !Number.isFinite(Date.parse(pick.settled_at)))
        ) {
          throw new Error('Performance settlement time is unavailable');
        }
        const performance: PublicPerformanceRecord = {
          pickId: pick.id,
          capperId: capper.id,
          capperName: capper.display_name,
          sport: pick.sport_id,
          odds: pick.odds,
          stakeUnits: pick.stake_units,
          settlement,
        };
        return {
          evidence: [...baseEvidence, capper, settlements],
          performance,
        };
      }),
    );
    for (const result of batch) {
      evidence.push(result.evidence);
      if (result.performance) records.push(result.performance);
    }
  }
  return { records, fingerprint: fingerprint(evidence) };
}

/** Read-only public aggregates; no request can widen the eligibility predicate. */
export async function getMemberPerformance(
  repositories: RepositoryBundle,
  options: MemberPerformanceOptions,
) {
  const first = await readSnapshot(repositories);
  const second = await readSnapshot(repositories);
  if (first.fingerprint !== second.fingerprint)
    throw new Error('Performance changed during read');
  // This is bounded change detection, not a transactional cross-query snapshot.
  return aggregateMemberPerformance(second.records, options);
}
