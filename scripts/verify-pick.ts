import { createClient } from '@supabase/supabase-js';
import { loadEnvironment } from '@unit-talk/config';

const env = loadEnvironment();

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const args = process.argv.slice(2);
const pickId = args.find((value) => !value.startsWith('--'));

if (!pickId) {
  throw new Error('Usage: tsx scripts/verify-pick.ts <pick-id> [--json]');
}

const json = args.includes('--json');

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main(): Promise<void> {
  const pick = await fetchSingle('picks', '*', 'id', pickId);

  if (!pick) {
    if (json) {
      console.log(
        JSON.stringify(
          {
            verdict: 'NOT_FOUND',
            pick: null,
            lifecycle: [],
            promotionHistory: [],
            outboxEntries: [],
            receipts: [],
            settlementRecords: [],
            auditLog: [],
          },
          null,
          2,
        ),
      );
    } else {
      console.log('Verdict: NOT FOUND');
    }
    process.exitCode = 1;
    return;
  }

  const [lifecycle, promotionHistory, outboxEntries, settlementRecords, auditLog] = await Promise.all([
    fetchMany('pick_lifecycle', '*', 'pick_id', pickId),
    fetchMany('pick_promotion_history', '*', 'pick_id', pickId),
    fetchMany('distribution_outbox', '*', 'pick_id', pickId),
    fetchMany('settlement_records', '*', 'pick_id', pickId),
    fetchMany('audit_log', '*', 'entity_ref', pickId),
  ]);

  const receipts = (
    await Promise.all(
      outboxEntries.map(async (entry) => fetchSingle('distribution_receipts', '*', 'outbox_id', String(entry.id))),
    )
  ).filter((value): value is Record<string, unknown> => value !== null);

  const verdict = buildVerdict({
    pick,
    lifecycle,
    promotionHistory,
    outboxEntries,
    receipts,
    settlementRecords,
    auditLog,
  });

  if (json) {
    console.log(
      JSON.stringify(
        {
          verdict,
          pick,
          lifecycle,
          promotionHistory,
          outboxEntries,
          receipts,
          settlementRecords,
          auditLog,
        },
        null,
        2,
      ),
    );
    return;
  }

  printReport({
    verdict,
    pick,
    lifecycle,
    promotionHistory,
    outboxEntries,
    receipts,
    settlementRecords,
    auditLog,
  });
}

async function fetchSingle(
  table: string,
  columns: string,
  key: string,
  value: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await db.from(table).select(columns).eq(key, value).limit(1);
  if (error) {
    throw new Error(`Failed querying ${table}: ${error.message}`);
  }

  return (data?.[0] as Record<string, unknown> | undefined) ?? null;
}

async function fetchMany(
  table: string,
  columns: string,
  key: string,
  value: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await db
    .from(table)
    .select(columns)
    .eq(key, value)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed querying ${table}: ${error.message}`);
  }

  return (data ?? []) as Array<Record<string, unknown>>;
}

function buildVerdict(input: {
  pick: Record<string, unknown>;
  lifecycle: Array<Record<string, unknown>>;
  promotionHistory: Array<Record<string, unknown>>;
  outboxEntries: Array<Record<string, unknown>>;
  receipts: Array<Record<string, unknown>>;
  settlementRecords: Array<Record<string, unknown>>;
  auditLog: Array<Record<string, unknown>>;
}): string {
  const status = String(input.pick.status ?? '');
  const lastLifecycle = input.lifecycle.at(-1);
  const lastState = String(lastLifecycle?.to_state ?? '');
  const hasSentOutbox = input.outboxEntries.some((entry) => entry.status === 'sent');
  const hasReceipt = input.receipts.length > 0;
  const hasSettlement = input.settlementRecords.length > 0;

  if (status === 'posted' && (!hasSentOutbox || !hasReceipt)) {
    return 'INCONSISTENT_POSTING';
  }

  if (status === 'settled' && !hasSettlement) {
    return 'INCONSISTENT_SETTLEMENT';
  }

  if (lastState && status && lastState !== status) {
    return 'LIFECYCLE_MISMATCH';
  }

  return 'VERIFIED';
}

function printReport(input: {
  verdict: string;
  pick: Record<string, unknown>;
  lifecycle: Array<Record<string, unknown>>;
  promotionHistory: Array<Record<string, unknown>>;
  outboxEntries: Array<Record<string, unknown>>;
  receipts: Array<Record<string, unknown>>;
  settlementRecords: Array<Record<string, unknown>>;
  auditLog: Array<Record<string, unknown>>;
}): void {
  console.log(`# Pick Verification Report`);
  console.log('');
  console.log(`Pick: ${input.pick.id}`);
  console.log(
    `Status: ${input.pick.status} | Approval: ${input.pick.approval_status} | Promotion: ${input.pick.promotion_status ?? 'n/a'} -> ${input.pick.promotion_target ?? 'n/a'}`,
  );
  console.log(`Verdict: ${input.verdict}`);
  console.log('');

  console.log('Lifecycle');
  if (input.lifecycle.length === 0) {
    console.log('- (none)');
  } else {
    for (const row of input.lifecycle) {
      console.log(`- ${row.from_state ?? 'null'} -> ${row.to_state} @ ${row.created_at}`);
    }
  }

  console.log('');
  console.log(`Promotion history rows: ${input.promotionHistory.length}`);
  for (const row of input.promotionHistory) {
    console.log(
      `- ${row.target}: ${row.promotion_status} score=${row.promotion_score ?? 'n/a'} @ ${row.created_at}`,
    );
  }

  console.log('');
  console.log(`Outbox rows: ${input.outboxEntries.length} | Receipts: ${input.receipts.length}`);
  for (const row of input.outboxEntries) {
    console.log(
      `- outbox ${row.id}: target=${row.target} status=${row.status} claimed_at=${row.claimed_at ?? 'n/a'}`,
    );
  }
  for (const row of input.receipts) {
    console.log(
      `- receipt ${row.id}: channel=${row.channel} message_id=${row.message_id ?? 'n/a'} delivered_at=${row.delivered_at ?? 'n/a'}`,
    );
  }

  console.log('');
  console.log(`Settlement rows: ${input.settlementRecords.length}`);
  for (const row of input.settlementRecords) {
    console.log(
      `- settlement ${row.id}: status=${row.status} result=${row.result ?? 'n/a'} corrects_id=${row.corrects_id ?? 'n/a'}`,
    );
  }

  console.log('');
  console.log(`Audit rows by entity_ref: ${input.auditLog.length}`);
  for (const row of input.auditLog) {
    console.log(`- ${row.action} entity_id=${row.entity_id} @ ${row.created_at}`);
  }
}
