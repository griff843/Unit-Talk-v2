import { readFileSync } from 'node:fs';

import { DEFAULT_ARCHIVE_REGISTRY } from '../archive/registry.js';
import { RunStore } from '../run-history/run-store.js';
import type { StageResult, UnifiedRunRecord } from '../run-history/types.js';
import { DEFAULT_REGISTRY } from '../scenarios/registry.js';
import { createReplaySimulationManifest } from './simulation-adapters.js';
import type { ReplayEvent } from './event-store.js';
import { JournalEventStore } from './event-store.js';
import type { ReplayProofArtifact } from './replay-proof-writer.js';
import { ReplayProofWriter } from './replay-proof-writer.js';
import { ReplayOrchestrator } from './replay-orchestrator.js';
import { VirtualEventClock } from './clock.js';

export type SlateReplayVolumeMode = '1x' | '2x';
export type SlateReplayHookStatus = 'captured' | 'failed' | 'skipped';

export interface SlateReplayHookCapture {
  hookId: string;
  status: SlateReplayHookStatus;
  source: string;
  capturedAt: string;
  payload?: unknown;
  error?: string;
}

export interface SlateReplayHarnessOptions {
  repoRoot: string;
  runId: string;
  scenarioId: string;
  fixturePath?: string;
  archiveSourceId?: string;
  commitHash: string;
  volumeMode: SlateReplayVolumeMode;
  freshnessCapture?: SlateReplayHookCapture;
  dbMetricsCapture?: SlateReplayHookCapture;
  extraArtifacts?: ReadonlyArray<ReplayProofArtifact>;
}

export interface SlateReplayMachineSummary {
  runId: string;
  scenarioId: string;
  bundleDir: string;
  mode: 'replay';
  volumeMode: SlateReplayVolumeMode;
  volumeMultiplier: number;
  baseEventCount: number;
  expandedEventCount: number;
  expectedPickCount: number;
  determinismVerified: boolean;
  firstRunHash: string;
  secondRunHash: string;
  errorCount: number;
  lifecycleStagesObserved: string[];
  freshnessCaptureStatus: SlateReplayHookStatus;
  dbMetricsCaptureStatus: SlateReplayHookStatus;
}

export interface SlateReplayHarnessResult {
  summary: SlateReplayMachineSummary;
  firstRun: Awaited<ReturnType<ReplayOrchestrator['run']>>;
  secondRunHash: string;
  expandedEvents: ReplayEvent[];
  bundleDir: string;
  runRecord: UnifiedRunRecord;
}

interface LegacyFixtureEvent {
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export async function runSlateReplayHarness(
  options: SlateReplayHarnessOptions
): Promise<SlateReplayHarnessResult> {
  const scenario = DEFAULT_REGISTRY.get(options.scenarioId);
  if (!scenario) {
    throw new Error(`Slate replay scenario not found: ${options.scenarioId}`);
  }

  const fixturePath = options.fixturePath ?? resolveFixturePath(options.scenarioId, options.archiveSourceId);
  if (!fixturePath) {
    throw new Error(`Slate replay fixture not found for scenario: ${options.scenarioId}`);
  }

  const baseEvents = loadEvents(fixturePath);
  if (baseEvents.length === 0) {
    throw new Error(`Slate replay fixture is empty: ${fixturePath}`);
  }

  const expandedEvents = expandEventsForVolume(baseEvents, options.volumeMode);
  const firstRun = await runDeterministicReplay(options.runId, expandedEvents);
  const secondRun = await runDeterministicReplay(`${options.runId}-verify`, expandedEvents);

  const supplementalArtifacts: ReplayProofArtifact[] = [
    {
      filename: 'metrics.json',
      format: 'json',
      content: buildReplayMetrics(baseEvents, expandedEvents, options.volumeMode, firstRun, secondRun),
    },
    {
      filename: 'freshness.json',
      format: 'json',
      content: options.freshnessCapture ?? skippedCapture('freshness', 'not requested'),
    },
    {
      filename: 'db-metrics.json',
      format: 'json',
      content: options.dbMetricsCapture ?? skippedCapture('db-metrics', 'not requested'),
    },
    ...(options.extraArtifacts ?? []),
  ];

  const writer = new ReplayProofWriter(options.repoRoot);
  const bundleDir = writer.write(firstRun, expandedEvents, secondRun.determinismHash, supplementalArtifacts);

  const lifecycleStagesObserved = collectObservedStages(firstRun);
  const summary: SlateReplayMachineSummary = {
    runId: options.runId,
    scenarioId: options.scenarioId,
    bundleDir,
    mode: 'replay',
    volumeMode: options.volumeMode,
    volumeMultiplier: volumeMultiplier(options.volumeMode),
    baseEventCount: baseEvents.length,
    expandedEventCount: expandedEvents.length,
    expectedPickCount: countDistinctPicks(expandedEvents),
    determinismVerified: firstRun.determinismHash === secondRun.determinismHash,
    firstRunHash: firstRun.determinismHash,
    secondRunHash: secondRun.determinismHash,
    errorCount: firstRun.errors.length,
    lifecycleStagesObserved,
    freshnessCaptureStatus: (options.freshnessCapture ?? skippedCapture('freshness', 'not requested')).status,
    dbMetricsCaptureStatus: (options.dbMetricsCapture ?? skippedCapture('db-metrics', 'not requested')).status,
  };

  const runRecord = buildRunRecord(options, summary, scenario.lifecycleStagesExpected, firstRun);
  const store = new RunStore(options.repoRoot);
  store.appendRun(runRecord);

  return {
    summary,
    firstRun,
    secondRunHash: secondRun.determinismHash,
    expandedEvents,
    bundleDir,
    runRecord,
  };
}

export function expandEventsForVolume(
  baseEvents: ReadonlyArray<ReplayEvent>,
  volumeMode: SlateReplayVolumeMode
): ReplayEvent[] {
  const copies = volumeMultiplier(volumeMode);
  const expanded: Array<ReplayEvent & { __copyIndex: number; __sourceSequence: number }> = [];

  for (let copyIndex = 0; copyIndex < copies; copyIndex += 1) {
    for (const event of baseEvents) {
      expanded.push(remapReplayEvent(event, copyIndex));
    }
  }

  expanded.sort((left, right) => {
    const byTimestamp = Date.parse(left.timestamp) - Date.parse(right.timestamp);
    if (byTimestamp !== 0) {
      return byTimestamp;
    }

    const bySourceSequence = left.__sourceSequence - right.__sourceSequence;
    if (bySourceSequence !== 0) {
      return bySourceSequence;
    }

    return left.__copyIndex - right.__copyIndex;
  });

  return expanded.map((event, index) => {
    const { __copyIndex: _copyIndex, __sourceSequence: _sourceSequence, ...rest } = event;
    return {
      ...rest,
      sequenceNumber: index + 1,
    };
  });
}

function volumeMultiplier(volumeMode: SlateReplayVolumeMode): number {
  return volumeMode === '2x' ? 2 : 1;
}

function remapReplayEvent(
  event: ReplayEvent,
  copyIndex: number
): ReplayEvent & { __copyIndex: number; __sourceSequence: number } {
  const nextCopy = copyIndex + 1;
  const pickId = event.pickId ? `${event.pickId}::copy-${nextCopy}` : undefined;
  const payload = { ...event.payload };
  const pick = payload['pick'];
  if (pick && typeof pick === 'object' && !Array.isArray(pick)) {
    const currentId = (pick as Record<string, unknown>)['id'];
    if (typeof currentId === 'string') {
      payload['pick'] = {
        ...(pick as Record<string, unknown>),
        id: `${currentId}::copy-${nextCopy}`,
      };
    }
  }

  payload['slateReplayCopyIndex'] = nextCopy;
  payload['slateReplaySourceEventId'] = event.eventId;

  return {
    ...event,
    eventId: `${event.eventId}::copy-${nextCopy}`,
    pickId,
    payload,
    __copyIndex: nextCopy,
    __sourceSequence: event.sequenceNumber,
  };
}

async function runDeterministicReplay(runId: string, events: ReadonlyArray<ReplayEvent>) {
  const store = JournalEventStore.fromEvents(events);
  const firstEvent = events[0];
  if (!firstEvent) {
    throw new Error('Slate replay requires at least one event');
  }

  const firstEventTime = new Date(firstEvent.timestamp);
  const clock = new VirtualEventClock(new Date(firstEventTime.getTime() - 1));
  const orchestrator = new ReplayOrchestrator({
    runId,
    eventStore: store,
    clock,
    adapters: createReplaySimulationManifest(store),
  });

  return orchestrator.run();
}

function loadEvents(fixturePath: string): ReplayEvent[] {
  const content = readFileSync(fixturePath, 'utf8');
  const lines = content
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  return lines.map((line, index) => normalizeFixtureEvent(JSON.parse(line) as Record<string, unknown>, index));
}

function normalizeFixtureEvent(raw: Record<string, unknown>, index: number): ReplayEvent {
  if (typeof raw['eventId'] === 'string' && typeof raw['eventType'] === 'string') {
    return {
      eventId: raw['eventId'],
      eventType: raw['eventType'] as ReplayEvent['eventType'],
      pickId: typeof raw['pickId'] === 'string' ? raw['pickId'] : undefined,
      timestamp: String(raw['timestamp']),
      sequenceNumber: typeof raw['sequenceNumber'] === 'number' ? raw['sequenceNumber'] : index + 1,
      payload: (raw['payload'] as Record<string, unknown>) ?? {},
      producedAt: typeof raw['producedAt'] === 'string' ? raw['producedAt'] : String(raw['timestamp']),
    };
  }

  const legacy = raw as unknown as LegacyFixtureEvent;
  if (!legacy.type || !legacy.timestamp || !legacy.payload) {
    throw new Error(`Replay fixture line ${index + 1} is missing required fields`);
  }

  const pickId =
    typeof legacy.payload['pickId'] === 'string'
      ? legacy.payload['pickId']
      : typeof legacy.payload['submissionId'] === 'string'
        ? legacy.payload['submissionId']
        : undefined;

  switch (legacy.type) {
    case 'submission.validated':
      return {
        eventId: `legacy-${index + 1}`,
        eventType: 'PICK_SUBMITTED',
        pickId,
        timestamp: legacy.timestamp,
        sequenceNumber: index + 1,
        producedAt: legacy.timestamp,
        payload: {
          pick: {
            id: pickId,
            status: 'validated',
            posted_to_discord: false,
          },
        },
      };
    case 'promotion.queued':
      return {
        eventId: `legacy-${index + 1}`,
        eventType: 'PICK_GRADED',
        pickId,
        timestamp: legacy.timestamp,
        sequenceNumber: index + 1,
        producedAt: legacy.timestamp,
        payload: {
          gradingData: {
            status: 'queued',
          },
        },
      };
    case 'distribution.sent':
      return {
        eventId: `legacy-${index + 1}`,
        eventType: 'PICK_POSTED',
        pickId,
        timestamp: legacy.timestamp,
        sequenceNumber: index + 1,
        producedAt: legacy.timestamp,
        payload: {
          posting: {
            target: legacy.payload['target'],
          },
        },
      };
    case 'settlement.recorded':
      return {
        eventId: `legacy-${index + 1}`,
        eventType: 'PICK_SETTLED',
        pickId,
        timestamp: legacy.timestamp,
        sequenceNumber: index + 1,
        producedAt: legacy.timestamp,
        payload: {
          result: legacy.payload['result'],
          source: 'legacy-fixture-normalized',
        },
      };
    default:
      throw new Error(`Replay fixture line ${index + 1} uses unsupported legacy type '${legacy.type}'`);
  }
}

function resolveFixturePath(scenarioId: string, archiveSourceId?: string): string | undefined {
  if (archiveSourceId) {
    return DEFAULT_ARCHIVE_REGISTRY.getFixturePath(archiveSourceId);
  }

  const scenarioFixture = DEFAULT_REGISTRY.getFixturePath(scenarioId);
  if (scenarioFixture) {
    return scenarioFixture;
  }

  const replayPack = DEFAULT_ARCHIVE_REGISTRY
    .getAllReplayPacks()
    .find(pack => pack.scenarioId === scenarioId);
  return replayPack ? DEFAULT_ARCHIVE_REGISTRY.getFixturePath(replayPack.archiveSourceId) : undefined;
}

function buildReplayMetrics(
  baseEvents: ReadonlyArray<ReplayEvent>,
  expandedEvents: ReadonlyArray<ReplayEvent>,
  volumeMode: SlateReplayVolumeMode,
  firstRun: Awaited<ReturnType<ReplayOrchestrator['run']>>,
  secondRun: Awaited<ReturnType<ReplayOrchestrator['run']>>
) {
  return {
    scenario: 'slate-replay',
    volumeMode,
    volumeMultiplier: volumeMultiplier(volumeMode),
    volumeStrategy: 'fixture-copy-namespaced-identities',
    baseEventCount: baseEvents.length,
    expandedEventCount: expandedEvents.length,
    distinctPickCount: countDistinctPicks(expandedEvents),
    firstRun: {
      determinismHash: firstRun.determinismHash,
      eventsProcessed: firstRun.eventsProcessed,
      eventsSkipped: firstRun.eventsSkipped,
      picksCreated: firstRun.picksCreated,
      errorCount: firstRun.errors.length,
    },
    secondRun: {
      determinismHash: secondRun.determinismHash,
      eventsProcessed: secondRun.eventsProcessed,
      eventsSkipped: secondRun.eventsSkipped,
      picksCreated: secondRun.picksCreated,
      errorCount: secondRun.errors.length,
    },
    determinismVerified: firstRun.determinismHash === secondRun.determinismHash,
  };
}

function buildRunRecord(
  options: SlateReplayHarnessOptions,
  summary: SlateReplayMachineSummary,
  expectedStages: ReadonlyArray<string>,
  firstRun: Awaited<ReturnType<ReplayOrchestrator['run']>>
): UnifiedRunRecord {
  const stageResults: StageResult[] = expectedStages.map(stage => ({
    stage,
    observed: summary.lifecycleStagesObserved.includes(stage),
    count: summary.lifecycleStagesObserved.filter(observed => observed === stage).length,
    detail: `volume=${summary.volumeMode}`,
  }));

  return {
    runId: summary.runId,
    scenarioId: options.scenarioId,
    mode: 'replay',
    commitHash: options.commitHash,
    startedAt: firstRun.startedAt,
    completedAt: firstRun.completedAt,
    durationMs: firstRun.durationMs,
    verdict:
      summary.determinismVerified &&
      summary.errorCount === 0 &&
      stageResults.every(result => result.observed)
        ? 'PASS'
        : 'FAIL',
    stageResults,
    artifactPath: summary.bundleDir,
    metadata: {
      volumeMode: summary.volumeMode,
      volumeMultiplier: summary.volumeMultiplier,
      baseEventCount: summary.baseEventCount,
      expandedEventCount: summary.expandedEventCount,
      determinismVerified: summary.determinismVerified,
      freshnessCaptureStatus: summary.freshnessCaptureStatus,
      dbMetricsCaptureStatus: summary.dbMetricsCaptureStatus,
      unresolvedIdentitySemantics:
        'TODO: map exported slate packs to provider-cycle truth before production replay cutover.',
    },
  };
}

function collectObservedStages(result: Awaited<ReturnType<ReplayOrchestrator['run']>>): string[] {
  return result.lifecycleTrace.map(trace => trace.to);
}

function countDistinctPicks(events: ReadonlyArray<ReplayEvent>): number {
  return new Set(
    events
      .map(event => event.pickId)
      .filter((pickId): pickId is string => typeof pickId === 'string')
  ).size;
}

function skippedCapture(hookId: string, source: string): SlateReplayHookCapture {
  return {
    hookId,
    status: 'skipped',
    source,
    capturedAt: new Date().toISOString(),
  };
}
