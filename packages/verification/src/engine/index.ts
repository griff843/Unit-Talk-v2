/**
 * VERIFICATION & SIMULATION CONTROL PLANE — V2
 * Ported from V1 R1-R5 system.
 *
 * R1: Foundation (clock, adapters, run controller)
 * R2: Deterministic Replay (event store, replay orchestrator, determinism validator)
 * R3: Shadow Mode (shadow pipeline, comparator, orchestrator)
 * R4: Fault Injection (fault injector, orchestrator, assertion engine)
 * R5: Execution Simulation (strategy evaluation, proof writers)
 */

// V2 type bridge
export * from './v2-type-bridge.js';

// R1: Clock abstraction
export type { ClockProvider, MutableClockProvider, ClockAdvancement } from './clock.js';
export { RealClockProvider, VirtualEventClock, resolveNow } from './clock.js';

// R1: Adapter contracts
export type {
  ExecutionMode,
  PublishReceipt,
  PublishAdapter,
  AlertSeverity,
  NotificationAlert,
  NotificationAdapter,
  FeedEvent,
  FeedAdapter,
  SettlementData,
  SettlementAdapter,
  RecapPeriod,
  RecapOutput,
  RecapAdapter,
  AdapterManifest,
} from './adapters.js';
export { isProductionMode, isNonProductionMode, assertManifestConsistency } from './adapters.js';

// R1: Safe non-production adapters
export type { RecordedPublish } from './adapters/recording-publish.js';
export { RecordingPublishAdapter } from './adapters/recording-publish.js';
export type { SuppressedAlert } from './adapters/null-notification.js';
export { NullNotificationAdapter } from './adapters/null-notification.js';
export { NullRecapAdapter } from './adapters/null-recap.js';
export type { RecordedRecap } from './adapters/recording-recap.js';
export { RecordingRecapAdapter } from './adapters/recording-recap.js';

// R1: RunController
export type { RunConfig, RunManifest } from './run-controller.js';
export { RunController, parseExecutionMode, VALID_EXECUTION_MODES } from './run-controller.js';

// R2: Event store
export type { ReplayEvent, ReplayEventType } from './event-store.js';
export { JournalEventStore, storeFromJsonl } from './event-store.js';

// R2: Production event recorder
export { ProductionEventRecorder } from './production-event-recorder.js';

// R2: Isolated storage
export { IsolatedPickStore } from './isolated-pick-store.js';

// R2: Replay lifecycle runner
export { ReplayLifecycleRunner } from './replay-lifecycle-runner.js';
export type { ReplayOperationResult, LifecycleTrace } from './replay-lifecycle-runner.js';

// R2: Replay orchestrator
export { ReplayOrchestrator } from './replay-orchestrator.js';
export type { ReplayRunConfig, ReplayResult, ReplayError } from './replay-orchestrator.js';

// R2: Determinism validator
export { DeterminismValidator } from './determinism-validator.js';

// R2: Proof writer
export { ReplayProofWriter } from './replay-proof-writer.js';
export type { ReplayProofArtifact } from './replay-proof-writer.js';

// R2: Replay adapters
export { ReplayFeedAdapter } from './adapters/replay-feed.js';
export { ReplaySettlementAdapter } from './adapters/replay-settlement.js';
export { runSlateReplayHarness, expandEventsForVolume } from './slate-replay.js';
export type {
  SlateReplayHookCapture,
  SlateReplayHookStatus,
  SlateReplayHarnessOptions,
  SlateReplayHarnessResult,
  SlateReplayMachineSummary,
  SlateReplayVolumeMode,
} from './slate-replay.js';

// R3: Shadow mode
export { ShadowFeedAdapter } from './adapters/shadow-feed.js';
export { ShadowPipelineRunner } from './shadow-pipeline-runner.js';
export type { ShadowPipelineResult, ShadowError } from './shadow-pipeline-runner.js';
export { ShadowComparator } from './shadow-comparator.js';
export type { DivergenceEntry, DivergenceReport } from './shadow-comparator.js';
export { ShadowOrchestrator } from './shadow-orchestrator.js';
export type { ShadowRunConfig, ShadowResult } from './shadow-orchestrator.js';
export { ShadowProofWriter } from './shadow-proof-writer.js';

// R3: Shadow guardrails
export * from './shadow/index.js';

// R4: Fault injection
export * from './fault/index.js';

// R5: Strategy evaluation
export * from './strategy/index.js';
