import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalJson,
  type AuditEvent,
  type DispatchPacket,
  type ExecutionRecord,
  sha256,
} from './contracts.js';
import { assertTransition } from './state-machine.js';

interface ActiveRunLease {
  schema_version: 1;
  run_id: string;
  session_id: string;
  acquired_at: string;
  expires_at: string;
  process_id: number;
  status: 'active' | 'released';
}

export type ClaimResult =
  | { ok: true; code: 'claimed' | 'resumed'; lease: ActiveRunLease }
  | {
      ok: false;
      code: 'active_run_conflict' | 'explicit_reclaim_required';
      lease: ActiveRunLease;
    };

export class FileAutonomyStore {
  readonly root: string;
  private readonly recordsDir: string;
  private readonly packetsDir: string;
  private readonly eventPath: string;
  private readonly activeRunPath: string;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.recordsDir = path.join(this.root, 'records');
    this.packetsDir = path.join(this.root, 'packets');
    this.eventPath = path.join(this.root, 'events.ndjson');
    this.activeRunPath = path.join(this.root, 'active-run.json');
    fs.mkdirSync(this.recordsDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.packetsDir, { recursive: true, mode: 0o700 });
  }

  claimRun(input: {
    run_id: string;
    session_id: string;
    now: string;
    expires_at: string;
    process_id?: number;
  }): ClaimResult {
    const lease: ActiveRunLease = {
      schema_version: 1,
      run_id: input.run_id,
      session_id: input.session_id,
      acquired_at: input.now,
      expires_at: input.expires_at,
      process_id: input.process_id ?? process.pid,
      status: 'active',
    };
    try {
      const fd = fs.openSync(this.activeRunPath, 'wx', 0o600);
      fs.writeFileSync(fd, `${JSON.stringify(lease, null, 2)}\n`, 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      return { ok: true, code: 'claimed', lease };
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }

    const existing = this.readLease();
    if (
      existing.status === 'active' &&
      existing.run_id === input.run_id &&
      existing.session_id === input.session_id
    ) {
      return { ok: true, code: 'resumed', lease: existing };
    }
    if (existing.status === 'released') {
      throw new Error('ACTIVE_RUN_RELEASED_RECORD_NOT_ARCHIVED');
    }
    if (Date.parse(existing.expires_at) <= Date.parse(input.now)) {
      return { ok: false, code: 'explicit_reclaim_required', lease: existing };
    }
    return { ok: false, code: 'active_run_conflict', lease: existing };
  }

  releaseRun(runId: string, sessionId: string, occurredAt: string): void {
    const lease = this.readLease();
    if (
      lease.run_id !== runId ||
      lease.session_id !== sessionId ||
      lease.status !== 'active'
    ) {
      throw new Error('ACTIVE_RUN_OWNER_MISMATCH');
    }
    const released = { ...lease, status: 'released' as const };
    this.atomicWrite(this.activeRunPath, released);
    this.appendEvent(runId, 'lease.released', occurredAt, {
      session_id: sessionId,
    });
    fs.renameSync(
      this.activeRunPath,
      path.join(this.root, `released-${runId}.json`),
    );
  }

  readRecord(runId: string): ExecutionRecord | null {
    const recordPath = this.recordPath(runId);
    if (!fs.existsSync(recordPath)) return null;
    return JSON.parse(fs.readFileSync(recordPath, 'utf8')) as ExecutionRecord;
  }

  createRecord(record: ExecutionRecord): void {
    const recordPath = this.recordPath(record.run_id);
    const fd = fs.openSync(recordPath, 'wx', 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    this.appendEvent(record.run_id, 'run.created', record.created_at, {
      state: record.state,
      input_hash: record.input_hash,
    });
  }

  transition(
    runId: string,
    next: ExecutionRecord,
    eventType:
      | 'state.transitioned'
      | 'decision.recorded'
      | 'packet.created'
      | 'run.completed',
    payload: Record<string, unknown>,
  ): void {
    const current = this.readRecord(runId);
    if (!current) throw new Error(`EXECUTION_RECORD_MISSING:${runId}`);
    assertTransition(current.state, next.state);
    if (next.transition_sequence !== current.transition_sequence + 1) {
      throw new Error('TRANSITION_SEQUENCE_INVALID');
    }
    if (
      current.input_hash !== next.input_hash ||
      current.session_id !== next.session_id
    ) {
      throw new Error('EXECUTION_RECORD_IDENTITY_MUTATION');
    }
    this.atomicWrite(this.recordPath(runId), next);
    this.appendEvent(runId, eventType, next.updated_at, {
      from: current.state,
      to: next.state,
      ...payload,
    });
  }

  appendResumeEvent(
    runId: string,
    occurredAt: string,
    processId = process.pid,
  ): void {
    this.appendEvent(runId, 'run.resumed', occurredAt, {
      process_id: processId,
    });
  }

  writePacket(packet: DispatchPacket): void {
    const packetPath = this.packetPath(packet.packet_id);
    const body = `${JSON.stringify(packet, null, 2)}\n`;
    try {
      const fd = fs.openSync(packetPath, 'wx', 0o400);
      fs.writeFileSync(fd, body, 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      const existing = fs.readFileSync(packetPath, 'utf8');
      if (existing !== body)
        throw new Error('IMMUTABLE_DISPATCH_PACKET_CONFLICT');
    }
  }

  readPacket(packetId: string): DispatchPacket {
    const packet = JSON.parse(
      fs.readFileSync(this.packetPath(packetId), 'utf8'),
    ) as DispatchPacket;
    const content = {
      schema_version: packet.schema_version,
      run_id: packet.run_id,
      decision_id: packet.decision_id,
      candidate: packet.candidate,
      created_at: packet.created_at,
    };
    if (
      packet.content_sha256 !== sha256(content) ||
      packet.packet_id !== `packet_${sha256(content)}`
    ) {
      throw new Error('DISPATCH_PACKET_INTEGRITY_FAILURE');
    }
    return packet;
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
    for (const event of this.readEvents()) {
      const content = {
        schema_version: event.schema_version,
        run_id: event.run_id,
        sequence: event.sequence,
        event_type: event.event_type,
        occurred_at: event.occurred_at,
        previous_hash: event.previous_hash,
        payload: event.payload,
      };
      const expectedHash = sha256(content);
      if (
        event.previous_hash !== previousHash ||
        event.event_hash !== expectedHash ||
        event.event_id !== `event_${expectedHash}`
      ) {
        return false;
      }
      previousHash = event.event_hash;
    }
    return true;
  }

  private appendEvent(
    runId: string,
    eventType: AuditEvent['event_type'],
    occurredAt: string,
    payload: Record<string, unknown>,
  ): void {
    const events = this.readEvents();
    const previous = events.at(-1) ?? null;
    const content = {
      schema_version: 1 as const,
      run_id: runId,
      sequence: events.length + 1,
      event_type: eventType,
      occurred_at: occurredAt,
      previous_hash: previous?.event_hash ?? null,
      payload,
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

  private readLease(): ActiveRunLease {
    return JSON.parse(
      fs.readFileSync(this.activeRunPath, 'utf8'),
    ) as ActiveRunLease;
  }

  private atomicWrite(target: string, value: unknown): void {
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    const fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(temp, target);
  }

  private recordPath(runId: string): string {
    return path.join(this.recordsDir, `${safeId(runId)}.json`);
  }

  private packetPath(packetId: string): string {
    return path.join(this.packetsDir, `${safeId(packetId)}.json`);
  }
}

function safeId(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value))
    throw new Error(`UNSAFE_AUTONOMY_ID:${value}`);
  return value;
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'EEXIST'
  );
}
