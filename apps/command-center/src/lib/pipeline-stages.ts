import type { DashboardData, DashboardRuntimeData, LifecycleSignal } from '@/lib/types';

/**
 * Single source of truth for the ingest→publish stage strip. Both the
 * Executive Overview and Today's Action render THIS model so their stage
 * counts can never disagree.
 */

export interface PipelineStageModel {
  name: string;
  count: number;
  status: 'healthy' | 'idle' | 'error';
}

export function pipelineStatus(signal: LifecycleSignal | undefined): PipelineStageModel['status'] {
  if (!signal) return 'idle';
  if (signal.status === 'BROKEN') return 'error';
  if (signal.status === 'DEGRADED') return 'idle';
  return 'healthy';
}

export function buildPipelineStages(
  data: DashboardData,
  runtime: DashboardRuntimeData,
): PipelineStageModel[] {
  const signalByName = new Map<LifecycleSignal['signal'], LifecycleSignal>(
    data.signals.map((signal) => [signal.signal, signal]),
  );

  return [
    { name: 'Ingest', count: runtime.providerSummary.active, status: pipelineStatus(signalByName.get('submission')) },
    { name: 'Normalize', count: data.picks.filter((pick) => pick.lifecycleStatus === 'validated').length, status: pipelineStatus(signalByName.get('scoring')) },
    { name: 'Grade', count: runtime.grading.runCount, status: pipelineStatus(signalByName.get('stats_propagation')) },
    { name: 'Promote', count: data.picks.filter((pick) => pick.promotionStatus === 'qualified').length, status: pipelineStatus(signalByName.get('promotion')) },
    { name: 'Publish', count: runtime.outbox.sent + runtime.receipts.sent, status: pipelineStatus(signalByName.get('discord_delivery')) },
  ];
}
