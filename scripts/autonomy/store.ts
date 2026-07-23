import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalJson,
  type AuditEvent,
  type AutonomyMode,
  type CandidateDecision,
  type CycleState,
  type DispatchPacket,
  type ExecutionRecord,
  type KernelExecutionState,
  type ReconciliationOutcome,
  sha256,
  type StructuredOutcome,
} from './contracts.js';
import {
  assertCycleTransition,
  assertOwnerModeTransition,
} from './state-machine.js';

export type BeginCycleResult =
  | { ok: true; state: KernelExecutionState; record: ExecutionRecord }
  | {
      ok: false;
      code:
        | 'ACTIVE_CYCLE_CONFLICT'
        | 'RECOVERY_RECONCILIATION_REQUIRED'
        | 'PERSISTED_MODE_MISMATCH';
      state: KernelExecutionState;
    };

export class FileAutonomyStore {
  readonly root: string;
  private readonly statePath: string;
  private readonly recordsDir: string;
  private readonly packetsDir: string;
  private readonly eventPath: string;
  private readonly claimLockPath: string;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.statePath = path.join(this.root, 'execution-state.json');
    this.recordsDir = path.join(this.root, 'records');
    this.packetsDir = path.join(this.root, 'packets');
    this.eventPath = path.join(this.root, 'events.ndjson');
    this.claimLockPath = path.join(this.root, 'cycle-claim.lock');
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.recordsDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.packetsDir, { recursive: true, mode: 0o700 });
  }

  initialize(now: string, heartbeatTtlSeconds = 900): KernelExecutionState {
    assertTimestamp(now, 'INITIAL_STATE_TIMESTAMP_INVALID');
    if (!Number.isInteger(heartbeatTtlSeconds) || heartbeatTtlSeconds < 1) {
      throw new Error('INITIAL_STATE_HEARTBEAT_TTL_INVALID');
    }
    const state: KernelExecutionState = {
      schema_version: 1,
      mode: 'halted',
      cycle_state: 'idle',
      halted: true,
      halted_reason: 'initial_state',
      current_cycle_id: null,
      last_cycle_started_at: null,
      last_cycle_completed_at: null,
      last_heartbeat_at: now,
      heartbeat_ttl_seconds: heartbeatTtlSeconds,
      owner_pid: null,
      consecutive_infra_failures: 0,
      consecutive_rollback_triggers: 0,
      cost_counters: {
        window_started_at: now,
        window_tokens_used: 0,
        window_dispatch_count: 0,
      },
      active_dispatch_ids: [],
      mode_history: [],
    };
    try {
      writeExclusive(this.statePath, state);
      return state;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      return this.readState();
    }
  }

  readState(): KernelExecutionState {
    if (!fs.existsSync(this.statePath)) {
      throw new Error('AUTONOMY_STATE_MISSING_FAIL_CLOSED');
    }
    let state: KernelExecutionState;
    try {
      state = JSON.parse(
        fs.readFileSync(this.statePath, 'utf8'),
      ) as KernelExecutionState;
    } catch {
      throw new Error('AUTONOMY_STATE_CORRUPT_FAIL_CLOSED');
    }
    validateState(state);
    return state;
  }

  setModeByOwner(
    to: AutonomyMode,
    at: string,
    trigger: string,
  ): KernelExecutionState {
    assertTimestamp(at, 'MODE_CHANGE_TIMESTAMP_INVALID');
    const state = this.readState();
    assertOwnerModeTransition(state.mode, to);
    if (state.cycle_state !== 'idle' && to !== 'halted') {
      throw new Error('OWNER_PROMOTION_REQUIRES_IDLE_CYCLE');
    }
    const next: KernelExecutionState = {
      ...state,
      mode: to,
      halted: to === 'halted',
      halted_reason: to === 'halted' ? trigger : null,
      mode_history:
        to === state.mode
          ? state.mode_history
          : [
              ...state.mode_history,
              { at, from: state.mode, to, trigger, actor: 'owner' as const },
            ],
    };
    this.atomicWrite(this.statePath, next);
    if (to !== state.mode) {
      this.appendAudit({
        event_type: to === 'halted' ? 'mode_rolled_back' : 'mode_promoted',
        phase: 'info',
        actor: 'owner',
        mode: to,
        severity: to === 'halted' ? 'high' : 'info',
        issue_id: null,
        idempotency_key: null,
        ts: at,
        detail: { from: state.mode, to, trigger },
      });
    }
    return next;
  }

  engageOwnerHalt(at: string, reason: string): KernelExecutionState {
    const state = this.setModeByOwner('halted', at, reason);
    this.appendAudit({
      event_type: 'kill_switch_engaged',
      phase: 'info',
      actor: 'owner',
      mode: 'halted',
      severity: 'critical',
      issue_id: null,
      idempotency_key: null,
      ts: at,
      detail: { reason },
    });
    return state;
  }

  beginCycle(input: {
    cycle_id: string;
    now: string;
    expected_mode: AutonomyMode;
    input_hash: string;
  }): BeginCycleResult {
    safeId(input.cycle_id);
    assertTimestamp(input.now, 'CYCLE_TIMESTAMP_INVALID');
    try {
      return this.withClaimLock(() => {
        const state = this.readState();
        if (state.mode !== input.expected_mode) {
          return { ok: false, code: 'PERSISTED_MODE_MISMATCH', state };
        }
        if (state.cycle_state !== 'idle') {
          return {
            ok: false,
            code: this.isHeartbeatFresh(state, input.now)
              ? 'ACTIVE_CYCLE_CONFLICT'
              : 'RECOVERY_RECONCILIATION_REQUIRED',
            state,
          };
        }
        const next: KernelExecutionState = {
          ...state,
          cycle_state: 'waking',
          current_cycle_id: input.cycle_id,
          last_cycle_started_at: input.now,
          last_heartbeat_at: input.now,
          owner_pid: process.pid,
        };
        const record: ExecutionRecord = {
          schema_version: 1,
          cycle_id: input.cycle_id,
          mode: state.mode,
          input_hash: input.input_hash,
          created_at: input.now,
          updated_at: input.now,
          transitions: [
            { sequence: 1, from: 'idle', to: 'waking', at: input.now },
          ],
        };
        writeExclusive(this.recordPath(input.cycle_id), record);
        this.atomicWrite(this.statePath, next);
        this.appendAudit({
          event_type: 'cycle_started',
          phase: 'info',
          actor: 'kernel',
          mode: state.mode,
          severity: 'info',
          issue_id: null,
          idempotency_key: null,
          ts: input.now,
          detail: { cycle_id: input.cycle_id },
        });
        return { ok: true, state: next, record };
      });
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      return {
        ok: false,
        code: 'ACTIVE_CYCLE_CONFLICT',
        state: this.readState(),
      };
    }
  }

  reconcileStaleCycle(
    at: string,
    outcomes: Readonly<Record<string, ReconciliationOutcome>>,
  ): KernelExecutionState {
    assertTimestamp(at, 'RECONCILIATION_TIMESTAMP_INVALID');
    return this.withClaimLock(() => {
      const state = this.readState();
      if (state.cycle_state === 'idle') return state;
      if (this.isHeartbeatFresh(state, at)) {
        throw new Error('ACTIVE_CYCLE_CANNOT_BE_RECONCILED');
      }
      for (const idempotencyKey of state.active_dispatch_ids) {
        const outcome = outcomes[idempotencyKey];
        if (!outcome) {
          throw new Error(`RECONCILIATION_TRUTH_REQUIRED:${idempotencyKey}`);
        }
        this.appendAudit({
          event_type: 'crash_recovery_reconciled',
          phase: 'outcome',
          actor: 'kernel',
          mode: state.mode,
          severity: 'high',
          issue_id: issueIdFromIdempotencyKey(idempotencyKey),
          idempotency_key: idempotencyKey,
          ts: at,
          detail: { outcome, prior_cycle_id: state.current_cycle_id },
        });
      }
      const next: KernelExecutionState = {
        ...state,
        cycle_state: 'idle',
        current_cycle_id: null,
        last_heartbeat_at: at,
        owner_pid: null,
        active_dispatch_ids: [],
      };
      this.atomicWrite(this.statePath, next);
      return next;
    });
  }

  transitionCycle(cycleId: string, to: CycleState, at: string): void {
    assertTimestamp(at, 'TRANSITION_TIMESTAMP_INVALID');
    const state = this.readState();
    if (state.current_cycle_id !== cycleId) {
      throw new Error('CYCLE_OWNER_MISMATCH');
    }
    assertCycleTransition(state.cycle_state, to);
    const record = this.readRecordRequired(cycleId);
    const sequence = record.transitions.length + 1;
    const nextRecord: ExecutionRecord = {
      ...record,
      updated_at: at,
      transitions: [
        ...record.transitions,
        { sequence, from: state.cycle_state, to, at },
      ],
    };
    const nextState: KernelExecutionState = {
      ...state,
      cycle_state: to,
      last_heartbeat_at: at,
      current_cycle_id: to === 'idle' ? null : state.current_cycle_id,
      last_cycle_completed_at:
        to === 'idle' ? at : state.last_cycle_completed_at,
      owner_pid: to === 'idle' ? null : process.pid,
    };
    this.atomicWrite(this.recordPath(cycleId), nextRecord);
    this.atomicWrite(this.statePath, nextState);
  }

  recordDecision(
    cycleId: string,
    decision: CandidateDecision,
    at: string,
  ): void {
    const record = this.readRecordRequired(cycleId);
    this.atomicWrite(this.recordPath(cycleId), {
      ...record,
      updated_at: at,
      decision,
    });
  }

  recordOutcome(cycleId: string, outcome: StructuredOutcome, at: string): void {
    const record = this.readRecordRequired(cycleId);
    this.atomicWrite(this.recordPath(cycleId), {
      ...record,
      updated_at: at,
      packet_id: outcome.packet_id ?? record.packet_id,
      outcome,
    });
  }

  readRecord(cycleId: string): ExecutionRecord | null {
    const target = this.recordPath(cycleId);
    if (!fs.existsSync(target)) return null;
    return JSON.parse(fs.readFileSync(target, 'utf8')) as ExecutionRecord;
  }

  writePacket(packet: DispatchPacket): void {
    const packetPath = this.packetPath(packet.packet_id);
    verifyPacketContent(packet);
    const body = `${JSON.stringify(packet, null, 2)}\n`;
    try {
      const fd = fs.openSync(packetPath, 'wx', 0o400);
      fs.writeFileSync(fd, body, 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      if (fs.readFileSync(packetPath, 'utf8') !== body) {
        throw new Error('IMMUTABLE_DISPATCH_PACKET_CONFLICT');
      }
    }
  }

  readPacket(packetId: string): DispatchPacket {
    const packet = JSON.parse(
      fs.readFileSync(this.packetPath(packetId), 'utf8'),
    ) as DispatchPacket;
    verifyPacketContent(packet);
    return packet;
  }

  markDispatchIntent(packet: DispatchPacket, at: string): void {
    const state = this.readState();
    if (state.halted) throw new Error('KILL_SWITCH_ENGAGED_BEFORE_DISPATCH');
    if (!state.active_dispatch_ids.includes(packet.idempotency_key)) {
      this.atomicWrite(this.statePath, {
        ...state,
        last_heartbeat_at: at,
        active_dispatch_ids: [
          ...state.active_dispatch_ids,
          packet.idempotency_key,
        ],
      });
    }
    this.appendAudit({
      event_type: 'dispatch_intent',
      phase: 'intent',
      actor: 'kernel',
      mode: state.mode,
      severity: 'info',
      issue_id: packet.issue_id,
      idempotency_key: packet.idempotency_key,
      ts: at,
      detail: { packet_id: packet.packet_id, dry_run: packet.dry_run },
    });
  }

  markDispatchOutcome(packet: DispatchPacket, at: string): void {
    const state = this.readState();
    this.appendAudit({
      event_type: packet.dry_run ? 'shadow_decision' : 'dispatch_outcome',
      phase: packet.dry_run ? 'info' : 'outcome',
      actor: 'kernel',
      mode: state.mode,
      severity: 'info',
      issue_id: packet.issue_id,
      idempotency_key: packet.dry_run ? null : packet.idempotency_key,
      ts: at,
      detail: { packet_id: packet.packet_id, dry_run: packet.dry_run },
    });
    this.atomicWrite(this.statePath, {
      ...state,
      last_heartbeat_at: at,
      active_dispatch_ids: state.active_dispatch_ids.filter(
        (entry) => entry !== packet.idempotency_key,
      ),
      cost_counters: {
        ...state.cost_counters,
        window_dispatch_count:
          state.cost_counters.window_dispatch_count + (packet.dry_run ? 0 : 1),
      },
    });
  }

  appendCycleCompleted(
    cycleId: string,
    mode: AutonomyMode,
    outcome: StructuredOutcome,
    at: string,
  ): void {
    this.appendAudit({
      event_type: 'cycle_completed',
      phase: 'info',
      actor: 'kernel',
      mode,
      severity: 'info',
      issue_id: null,
      idempotency_key: null,
      ts: at,
      detail: { cycle_id: cycleId, outcome },
    });
  }

  readEvents(): AuditEvent[] {
    if (!fs.existsSync(this.eventPath)) return [];
    return fs
      .readFileSync(this.eventPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AuditEvent);
  }

  verifyEventChain(): boolean {
    let previousHash: string | null = null;
    let expectedSequence = 1;
    for (const event of this.readEvents()) {
      const content = eventContent(event);
      const expectedHash = sha256(content);
      if (
        event.sequence !== expectedSequence ||
        event.prev_event_hash !== previousHash ||
        event.event_hash !== expectedHash ||
        event.event_id !== `event_${expectedHash}`
      ) {
        return false;
      }
      previousHash = event.event_hash;
      expectedSequence += 1;
    }
    return true;
  }

  private isHeartbeatFresh(state: KernelExecutionState, now: string): boolean {
    const ageMs = Date.parse(now) - Date.parse(state.last_heartbeat_at);
    if (!Number.isFinite(ageMs) || ageMs < 0) return true;
    return ageMs <= state.heartbeat_ttl_seconds * 1_000;
  }

  appendAudit(
    input: Omit<
      AuditEvent,
      | 'schema_version'
      | 'event_id'
      | 'sequence'
      | 'prev_event_hash'
      | 'event_hash'
    >,
  ): void {
    if (
      (input.phase === 'intent' || input.phase === 'outcome') &&
      !input.idempotency_key
    ) {
      throw new Error('AUDIT_IDEMPOTENCY_KEY_REQUIRED');
    }
    const events = this.readEvents();
    const previous = events.at(-1) ?? null;
    const content = {
      schema_version: 1 as const,
      sequence: events.length + 1,
      ts: input.ts,
      event_type: input.event_type,
      phase: input.phase,
      actor: input.actor,
      mode: input.mode,
      severity: input.severity,
      issue_id: input.issue_id,
      idempotency_key: input.idempotency_key,
      prev_event_hash: previous?.event_hash ?? null,
      detail: input.detail,
    };
    const eventHash = sha256(content);
    const event: AuditEvent = {
      ...content,
      event_id: `event_${eventHash}`,
      event_hash: eventHash,
    };
    const fd = fs.openSync(this.eventPath, 'a', 0o600);
    fs.writeFileSync(fd, `${canonicalJson(event)}\n`, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
  }

  private readRecordRequired(cycleId: string): ExecutionRecord {
    const record = this.readRecord(cycleId);
    if (!record) throw new Error(`EXECUTION_RECORD_MISSING:${cycleId}`);
    return record;
  }

  private withClaimLock<T>(callback: () => T): T {
    const fd = fs.openSync(this.claimLockPath, 'wx', 0o600);
    try {
      return callback();
    } finally {
      fs.closeSync(fd);
      fs.unlinkSync(this.claimLockPath);
    }
  }

  private atomicWrite(target: string, value: unknown): void {
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    const fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(temp, target);
  }

  private recordPath(cycleId: string): string {
    return path.join(this.recordsDir, `${safeId(cycleId)}.json`);
  }

  private packetPath(packetId: string): string {
    return path.join(this.packetsDir, `${safeId(packetId)}.json`);
  }
}

function validateState(state: KernelExecutionState): void {
  if (state.schema_version !== 1)
    throw new Error('AUTONOMY_STATE_VERSION_INVALID');
  if (!['halted', 'shadow', 't3_live', 't2t3_live'].includes(state.mode)) {
    throw new Error('AUTONOMY_STATE_MODE_INVALID');
  }
  if (
    ![
      'idle',
      'waking',
      'gating',
      'selecting',
      'dispatching',
      'shadow_evaluating',
      'reporting',
      'cooling_down',
    ].includes(state.cycle_state)
  ) {
    throw new Error('AUTONOMY_STATE_CYCLE_STATE_INVALID');
  }
  if (state.halted !== (state.mode === 'halted')) {
    throw new Error('AUTONOMY_STATE_HALT_INVARIANT_VIOLATION');
  }
  if (state.halted && !state.halted_reason) {
    throw new Error('AUTONOMY_STATE_HALTED_REASON_REQUIRED');
  }
  if ((state.cycle_state === 'idle') !== (state.current_cycle_id === null)) {
    throw new Error('AUTONOMY_STATE_CYCLE_ID_INVARIANT_VIOLATION');
  }
  assertTimestamp(state.last_heartbeat_at, 'AUTONOMY_STATE_HEARTBEAT_INVALID');
  if (
    !Number.isInteger(state.heartbeat_ttl_seconds) ||
    state.heartbeat_ttl_seconds < 1
  ) {
    throw new Error('AUTONOMY_STATE_HEARTBEAT_TTL_INVALID');
  }
  if (!Array.isArray(state.active_dispatch_ids)) {
    throw new Error('AUTONOMY_STATE_ACTIVE_DISPATCH_IDS_INVALID');
  }
  if (!Array.isArray(state.mode_history)) {
    throw new Error('AUTONOMY_STATE_MODE_HISTORY_INVALID');
  }
}

function verifyPacketContent(packet: DispatchPacket): void {
  if (packet.tier !== 'T2' && packet.tier !== 'T3') {
    throw new Error('T1_DISPATCH_PACKET_STRUCTURALLY_FORBIDDEN');
  }
  if (packet.mode_at_dispatch === 'shadow' && !packet.dry_run) {
    throw new Error('SHADOW_PACKET_MUST_BE_DRY_RUN');
  }
  const {
    content_sha256: _contentSha256,
    packet_id: _packetId,
    ...content
  } = packet;
  const digest = sha256(content);
  if (
    packet.content_sha256 !== digest ||
    packet.packet_id !== `packet_${digest}`
  ) {
    throw new Error('DISPATCH_PACKET_INTEGRITY_FAILURE');
  }
}

function eventContent(
  event: AuditEvent,
): Omit<AuditEvent, 'event_id' | 'event_hash'> {
  const { event_id: _eventId, event_hash: _eventHash, ...content } = event;
  return content;
}

function writeExclusive(target: string, value: unknown): void {
  const fd = fs.openSync(target, 'wx', 0o600);
  fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.fsyncSync(fd);
  fs.closeSync(fd);
}

function safeId(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`UNSAFE_AUTONOMY_ID:${value}`);
  }
  return value;
}

function assertTimestamp(value: string, code: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(code);
}

function issueIdFromIdempotencyKey(value: string): string | null {
  const match = /^(UTV2-[0-9]+):/.exec(value);
  return match?.[1] ?? null;
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'EEXIST'
  );
}
