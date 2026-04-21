import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnvironment } from '@unit-talk/config';
import type { SettlementRecord } from '@unit-talk/db';
import { pathToFileURL } from 'node:url';

export const WRONG_EVENT_ID = 'b16263e3-8f1c-437c-9a20-a10ffe9481d1';
export const CORRECT_EVENT_ID = '9eab4725-ff45-4955-a1e6-273b4285aeb3';
export const CORRECTION_SOURCE = 'operator-correction';
export const CORRECTION_ACTOR = 'utv2-665-correction';

export interface SettlementCorrectionTarget {
  pickId: string;
  label: string;
  wrongResult: 'win' | 'loss';
  correctResult: 'win' | 'loss';
}

export const UTV2_665_SETTLEMENT_TARGETS: readonly SettlementCorrectionTarget[] = [
  {
    pickId: '2a8fe3df-96e0-4b0e-9606-59514d2a3fe6',
    label: 'Gui Santos Points O 12.5',
    wrongResult: 'win',
    correctResult: 'loss',
  },
  {
    pickId: 'f7478c8f-0896-48bc-9082-adc14b47fcfd',
    label: 'Jalen Green Points O 20.5',
    wrongResult: 'loss',
    correctResult: 'win',
  },
];

export interface SettlementCorrectionCreateInput {
  pickId: string;
  status: 'settled';
  result: 'win' | 'loss';
  source: string;
  confidence: 'confirmed';
  evidenceRef: string;
  notes: string;
  settledBy: string;
  settledAt: string;
  correctsId: string;
  payload: Record<string, unknown>;
}

export interface SettlementCorrectionRepository {
  listByPick(pickId: string): Promise<SettlementRecord[]>;
  record(input: SettlementCorrectionCreateInput): Promise<SettlementRecord>;
}

export interface SettlementCorrectionInserted {
  pickId: string;
  label: string;
  originalSettlementId: string;
  correctionSettlementId: string;
  result: 'win' | 'loss';
}

export interface SettlementCorrectionSkipped {
  pickId: string;
  label: string;
  reason: 'already-corrected';
  correctionSettlementId: string;
}

export interface SettlementCorrectionSummary {
  inserted: SettlementCorrectionInserted[];
  skipped: SettlementCorrectionSkipped[];
}

function hasWrongEventPayload(record: SettlementRecord): boolean {
  const payload = record.payload as Record<string, unknown>;
  return (
    payload['event_id'] === WRONG_EVENT_ID ||
    payload['eventId'] === WRONG_EVENT_ID ||
    payload['wrongEventId'] === WRONG_EVENT_ID
  );
}

function findOriginalInvalidSettlement(
  target: SettlementCorrectionTarget,
  settlements: SettlementRecord[],
): SettlementRecord {
  const original =
    settlements.find(
      (settlement) =>
        settlement.corrects_id === null &&
        settlement.result === target.wrongResult &&
        hasWrongEventPayload(settlement),
    ) ??
    settlements.find(
      (settlement) =>
        settlement.corrects_id === null &&
        settlement.result === target.wrongResult,
    );

  if (!original) {
    throw new Error(
      `No original invalid settlement found for ${target.pickId} (${target.label})`,
    );
  }

  return original;
}

export async function appendUtv2SettlementCorrections(
  repository: SettlementCorrectionRepository,
  options?: {
    now?: string;
    targets?: readonly SettlementCorrectionTarget[];
  },
): Promise<SettlementCorrectionSummary> {
  const inserted: SettlementCorrectionInserted[] = [];
  const skipped: SettlementCorrectionSkipped[] = [];
  const settledAt = options?.now ?? new Date().toISOString();
  const targets = options?.targets ?? UTV2_665_SETTLEMENT_TARGETS;

  for (const target of targets) {
    const settlements = await repository.listByPick(target.pickId);
    const existingCorrection = settlements.find((settlement) => settlement.corrects_id !== null);

    if (existingCorrection) {
      skipped.push({
        pickId: target.pickId,
        label: target.label,
        reason: 'already-corrected',
        correctionSettlementId: existingCorrection.id,
      });
      continue;
    }

    const original = findOriginalInvalidSettlement(target, settlements);
    const correction = await repository.record({
      pickId: target.pickId,
      status: 'settled',
      result: target.correctResult,
      source: CORRECTION_SOURCE,
      confidence: 'confirmed',
      evidenceRef: CORRECT_EVENT_ID,
      notes: 'UTV2-665 additive correction for Warriors-Suns event disambiguation.',
      settledBy: CORRECTION_ACTOR,
      settledAt,
      correctsId: original.id,
      payload: {
        issue: 'UTV2-665',
        correctionReason: 'Feb 6 Warriors-Suns ghost settlement corrected to Apr 17 event.',
        wrongEventId: WRONG_EVENT_ID,
        correctEventId: CORRECT_EVENT_ID,
        originalSettlementId: original.id,
        originalResult: target.wrongResult,
        correctedResult: target.correctResult,
        selection: target.label,
      },
    });

    inserted.push({
      pickId: target.pickId,
      label: target.label,
      originalSettlementId: original.id,
      correctionSettlementId: correction.id,
      result: target.correctResult,
    });
  }

  return { inserted, skipped };
}

type SettlementRow = SettlementRecord;

class SupabaseSettlementCorrectionRepository implements SettlementCorrectionRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listByPick(pickId: string): Promise<SettlementRecord[]> {
    const { data, error } = await this.client
      .from('settlement_records')
      .select()
      .eq('pick_id', pickId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to query settlement_records for ${pickId}: ${error.message}`);
    }

    return (data ?? []) as SettlementRecord[];
  }

  async record(input: SettlementCorrectionCreateInput): Promise<SettlementRecord> {
    const insert: Partial<SettlementRow> = {
      pick_id: input.pickId,
      corrects_id: input.correctsId,
      status: input.status,
      result: input.result,
      evidence_ref: input.evidenceRef,
      source: input.source,
      settled_by: input.settledBy,
      settled_at: input.settledAt,
      confidence: input.confidence,
      notes: input.notes,
      payload: input.payload,
    };

    const { data, error } = await this.client
      .from('settlement_records')
      .insert(insert)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to insert UTV2-665 correction: ${error?.message ?? 'unknown error'}`);
    }

    return data as SettlementRecord;
  }
}

export async function runUtv2SettlementCorrection(): Promise<SettlementCorrectionSummary> {
  const env = loadEnvironment();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  }

  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  return appendUtv2SettlementCorrections(new SupabaseSettlementCorrectionRepository(client));
}

function printSummary(summary: SettlementCorrectionSummary): void {
  console.log(`UTV2-665 settlement corrections inserted: ${summary.inserted.length}`);
  for (const row of summary.inserted) {
    console.log(
      `inserted pick=${row.pickId} result=${row.result} original=${row.originalSettlementId} correction=${row.correctionSettlementId}`,
    );
  }

  console.log(`UTV2-665 settlement corrections skipped: ${summary.skipped.length}`);
  for (const row of summary.skipped) {
    console.log(
      `skipped pick=${row.pickId} reason=${row.reason} correction=${row.correctionSettlementId}`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runUtv2SettlementCorrection()
    .then(printSummary)
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
