/**
 * RevocationTriggerWiring (UTV2-1098 / INIT-2.1.3)
 *
 * Bridges runtime event emitters (InvariantEngine, QuarantineManager) to
 * CertificationLifecycleManager revocation-trigger methods.
 *
 * Design invariants:
 * - Pure event wiring — no I/O, no DB access.
 * - Fail-closed: wiring errors propagate; they are never swallowed.
 * - One wire call per emitter instance; calling twice is a programming error.
 * - dispose() removes all listeners to prevent memory leaks.
 */

import type { InvariantEngine, InvariantViolation } from '../engine.js';
import type { QuarantineManager, EscalationNotice } from '../quarantine.js';
import type { CertificationLifecycleManager, RevokeResult } from './lifecycle-manager.js';
import type { ProgramId, CertificationDomain } from './types.js';

// ---------------------------------------------------------------------------
// Wire options
// ---------------------------------------------------------------------------

export interface WireEngineOptions {
  /** The program to revoke when a violation is detected. */
  programId: ProgramId;
  /**
   * Domain to revoke. Required when violations may not carry domain context.
   * If the violation's context includes `certification_domain`, that wins.
   */
  domain: CertificationDomain;
  /**
   * SHA of the evidence bundle associated with the replay run.
   * Should match the current program's certification evidence_sha.
   */
  evidenceSha: string;
  /**
   * Merge SHA the violation was detected against.
   */
  mergeSha: string;
}

export interface WireQuarantineOptions {
  /** The program to revoke when a quarantine escalation fires. */
  programId: ProgramId;
  /**
   * SHA of the evidence bundle associated with the escalation.
   */
  evidenceSha: string;
  /**
   * Merge SHA the escalation was detected against.
   */
  mergeSha: string;
}

// ---------------------------------------------------------------------------
// RevocationTriggerWiring
// ---------------------------------------------------------------------------

export class RevocationTriggerWiring {
  private readonly _manager: CertificationLifecycleManager;
  private readonly _cleanups: Array<() => void> = [];
  private _disposed = false;

  constructor(manager: CertificationLifecycleManager) {
    this._manager = manager;
  }

  /**
   * Wire an InvariantEngine to trigger revocation on violation events.
   *
   * Replay-scoped violations (violation.replay_run_id present) call
   * onReplayNondeterminism(); all others call onInvariantViolationEscalation().
   */
  wireEngine(engine: InvariantEngine, opts: WireEngineOptions): this {
    this._assertNotDisposed();

    const listener = (violation: InvariantViolation): void => {
      const domain = (
        typeof violation.context['certification_domain'] === 'string'
          ? violation.context['certification_domain']
          : opts.domain
      ) as CertificationDomain;

      const detail = `invariant ${violation.invariant_id}: ${violation.title}`;

      let resultPromise: Promise<RevokeResult>;
      if (violation.replay_run_id != null) {
        resultPromise = this._manager.onReplayNondeterminism(
          opts.programId,
          domain,
          opts.evidenceSha,
          opts.mergeSha,
          `replay_run_id=${violation.replay_run_id}; ${detail}`,
        );
      } else {
        resultPromise = this._manager.onInvariantViolationEscalation(
          opts.programId,
          domain,
          opts.evidenceSha,
          opts.mergeSha,
          detail,
        );
      }

      // Propagate errors — fail-closed; do not swallow.
      resultPromise.catch((err: unknown) => {
        engine.emit('wiring_error', { violation, error: err });
      });
    };

    engine.on('violation', listener);
    this._cleanups.push(() => engine.off('violation', listener));
    return this;
  }

  /**
   * Wire a QuarantineManager to trigger revocation on escalation events.
   *
   * Escalations call onQuarantineBypass() on the lifecycle manager,
   * which maps to the 'quarantine_escalation' revocation signal.
   */
  wireQuarantineManager(qm: QuarantineManager, opts: WireQuarantineOptions): this {
    this._assertNotDisposed();

    const listener = (notice: EscalationNotice): void => {
      const detail =
        `quarantine_record_id=${notice.quarantine_record_id}; ` +
        `invariant=${notice.invariant_id}; target=${notice.target}`;

      const resultPromise = this._manager.onQuarantineBypass(
        opts.programId,
        opts.evidenceSha,
        opts.mergeSha,
        detail,
      );

      resultPromise.catch((err: unknown) => {
        qm.emit('wiring_error', { notice, error: err });
      });
    };

    qm.on('escalation', listener);
    this._cleanups.push(() => qm.off('escalation', listener));
    return this;
  }

  /**
   * Entry point for the replay harness: directly trigger replay nondeterminism
   * revocation without requiring an InvariantEngine listener.
   */
  async triggerReplayNondeterminism(
    programId: ProgramId,
    domain: CertificationDomain,
    evidenceSha: string,
    mergeSha: string,
    detail: string,
  ): Promise<RevokeResult> {
    this._assertNotDisposed();
    return this._manager.onReplayNondeterminism(
      programId,
      domain,
      evidenceSha,
      mergeSha,
      detail,
    );
  }

  /**
   * Entry point for the stale-proof detector: directly trigger stale proof
   * lineage revocation.
   */
  async triggerStaleProofLineage(
    programId: ProgramId,
    evidenceSha: string,
    mergeSha: string,
    detail: string,
  ): Promise<RevokeResult> {
    this._assertNotDisposed();
    return this._manager.onStaleProofLineage(
      programId,
      evidenceSha,
      mergeSha,
      detail,
    );
  }

  /**
   * Remove all event listeners added by this wiring instance.
   * Safe to call multiple times.
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    for (const cleanup of this._cleanups) {
      cleanup();
    }
    this._cleanups.length = 0;
  }

  private _assertNotDisposed(): void {
    if (this._disposed) {
      throw new Error('RevocationTriggerWiring has been disposed');
    }
  }
}
