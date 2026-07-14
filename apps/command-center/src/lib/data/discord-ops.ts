// Discord ops data module — derives per-target delivery truth from
// distribution_outbox + distribution_receipts (the only Discord-adjacent
// data this app can reach). Bot health / roles / permissions have no data
// source here; see src/lib/discord-ops-contract.ts.

import { getDataClient } from './client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const SUCCESS_RECEIPT_STATUSES = new Set(['sent', 'delivered', 'success', 'ok']);

export interface ChannelDeliveryStat {
  channel: string;
  lastSuccessAt: string | null;
  successCount: number;
  failureCount: number;
  lastReceiptAt: string | null;
}

export interface FailedDiscordPost {
  id: string;
  pickId: string;
  target: string;
  status: string;
  attemptCount: number;
  lastError: string | null;
  updatedAt: string;
}

export interface DiscordOpsSnapshot {
  channelStats: ChannelDeliveryStat[];
  failedPosts: FailedDiscordPost[];
  receiptsSampled: number;
}

export async function getDiscordOpsSnapshot(): Promise<DiscordOpsSnapshot> {
  const client: Client = getDataClient();

  const [receiptsResult, failedResult] = await Promise.all([
    client
      .from('distribution_receipts')
      .select('channel, status, recorded_at')
      .order('recorded_at', { ascending: false })
      .limit(500),
    client
      .from('distribution_outbox')
      .select('id, pick_id, target, status, attempt_count, last_error, updated_at')
      .in('status', ['failed', 'dead_letter'])
      .order('updated_at', { ascending: false })
      .limit(50),
  ]);

  if (receiptsResult.error) throw receiptsResult.error;
  if (failedResult.error) throw failedResult.error;

  const byChannel = new Map<string, ChannelDeliveryStat>();
  const receipts = (receiptsResult.data ?? []) as Array<Record<string, unknown>>;
  for (const row of receipts) {
    const channel = typeof row['channel'] === 'string' && row['channel'].length > 0 ? row['channel'] : '(unlabelled)';
    const status = String(row['status'] ?? '').toLowerCase();
    const recordedAt = typeof row['recorded_at'] === 'string' ? row['recorded_at'] : null;
    const stat = byChannel.get(channel) ?? {
      channel,
      lastSuccessAt: null,
      successCount: 0,
      failureCount: 0,
      lastReceiptAt: null,
    };
    if (recordedAt && (!stat.lastReceiptAt || Date.parse(recordedAt) > Date.parse(stat.lastReceiptAt))) {
      stat.lastReceiptAt = recordedAt;
    }
    if (SUCCESS_RECEIPT_STATUSES.has(status)) {
      stat.successCount += 1;
      if (recordedAt && (!stat.lastSuccessAt || Date.parse(recordedAt) > Date.parse(stat.lastSuccessAt))) {
        stat.lastSuccessAt = recordedAt;
      }
    } else {
      stat.failureCount += 1;
    }
    byChannel.set(channel, stat);
  }

  const channelStats = [...byChannel.values()].sort((a, b) =>
    (b.lastReceiptAt ? Date.parse(b.lastReceiptAt) : 0) - (a.lastReceiptAt ? Date.parse(a.lastReceiptAt) : 0),
  );

  const failedPosts: FailedDiscordPost[] = ((failedResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row['id'] ?? ''),
    pickId: String(row['pick_id'] ?? ''),
    target: String(row['target'] ?? ''),
    status: String(row['status'] ?? ''),
    attemptCount: Number(row['attempt_count'] ?? 0),
    lastError: typeof row['last_error'] === 'string' ? row['last_error'] : null,
    updatedAt: String(row['updated_at'] ?? ''),
  }));

  return { channelStats, failedPosts, receiptsSampled: receipts.length };
}

// UTV2-1427: delivery kill switch status — read directly from Supabase,
// matching this app's existing read pattern. The toggle itself is a write
// and goes through apps/api (see operations/discord/actions.ts).

export interface DeliveryKillSwitchStatus {
  target: string;
  killed: boolean;
  reason: string | null;
  actor: string | null;
  updatedAt: string;
}

export async function getDeliveryKillSwitchStatuses(): Promise<DeliveryKillSwitchStatus[]> {
  const client: Client = getDataClient();
  const { data, error } = await client.from('delivery_kill_switch').select('*');
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    target: String(row['target'] ?? ''),
    killed: Boolean(row['killed']),
    reason: typeof row['reason'] === 'string' ? row['reason'] : null,
    actor: typeof row['actor'] === 'string' ? row['actor'] : null,
    updatedAt: String(row['updated_at'] ?? ''),
  }));
}
