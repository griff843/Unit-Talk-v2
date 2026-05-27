import {
  CertificationLifecycleManager,
  RevocationTriggerWiring,
  type CertificationDomain,
  type CertificationRecord,
  type CertificationRepository,
  type CertificationTransitionEvent,
  type DependentGateEvent,
  type ProgramId,
  type PropagationAuditEvent,
  type TransitionResult,
} from '@unit-talk/invariants';
import {
  createDatabaseClientFromConnection,
  type DatabaseConnectionConfig,
  type UnitTalkSupabaseClient,
} from '@unit-talk/db';

type CertificationRecordRow = {
  id: string;
  program_id: ProgramId;
  domain: CertificationDomain;
  status: CertificationRecord['status'];
  evidence_sha: string;
  merge_sha: string;
  transitioned_at: string;
  transitioned_by: string;
  transition_reason: string;
  expires_at: string | null;
  revocation_trigger: CertificationRecord['revocationTrigger'];
  predecessor_id: string | null;
  created_at: string;
};

function toRow(record: CertificationRecord) {
  return {
    id: record.id,
    program_id: record.programId,
    domain: record.domain,
    status: record.status,
    evidence_sha: record.evidenceSha,
    merge_sha: record.mergeSha,
    transitioned_at: record.transitionedAt,
    transitioned_by: record.transitionedBy,
    transition_reason: record.transitionReason,
    expires_at: record.expiresAt,
    revocation_trigger: record.revocationTrigger,
    predecessor_id: record.predecessorId,
    created_at: record.createdAt,
  };
}

function toEventRow(event: CertificationTransitionEvent) {
  return {
    id: event.id,
    cert_record_id: event.certRecordId,
    program_id: event.programId,
    domain: event.domain,
    from_status: event.fromStatus,
    to_status: event.toStatus,
    triggered_by: event.triggeredBy,
    trigger_reason: event.triggerReason,
    evidence_sha: event.evidenceSha,
    occurred_at: event.occurredAt,
    replay_safe: event.replaySafe,
  };
}

function fromRow(row: CertificationRecordRow): CertificationRecord {
  return {
    id: row.id,
    programId: row.program_id,
    domain: row.domain,
    status: row.status,
    evidenceSha: row.evidence_sha,
    mergeSha: row.merge_sha,
    transitionedAt: row.transitioned_at,
    transitionedBy: row.transitioned_by,
    transitionReason: row.transition_reason,
    expiresAt: row.expires_at,
    revocationTrigger: row.revocation_trigger,
    predecessorId: row.predecessor_id,
    createdAt: row.created_at,
  };
}

export class DatabaseCertificationRepository implements CertificationRepository {
  constructor(private readonly client: UnitTalkSupabaseClient) {}

  async getCurrentRecord(
    programId: ProgramId,
    domain: CertificationDomain,
  ): Promise<CertificationRecord | null> {
    const { data, error } = await this.client
      .from('current_certification_state')
      .select('*')
      .eq('program_id', programId)
      .eq('domain', domain)
      .maybeSingle();

    if (error) {
      throw new Error(`certification current-state fetch failed for ${programId}/${domain}: ${error.message}`);
    }
    return data ? fromRow(data as CertificationRecordRow) : null;
  }

  async getAllCurrentRecords(
    programId: ProgramId,
  ): Promise<Partial<Record<CertificationDomain, CertificationRecord>>> {
    const { data, error } = await this.client
      .from('current_certification_state')
      .select('*')
      .eq('program_id', programId);

    if (error) {
      throw new Error(`certification current-state fetch failed for ${programId}: ${error.message}`);
    }

    const records: Partial<Record<CertificationDomain, CertificationRecord>> = {};
    for (const row of data ?? []) {
      const record = fromRow(row as CertificationRecordRow);
      records[record.domain] = record;
    }
    return records;
  }

  async insertTransition(
    record: CertificationRecord,
    event: CertificationTransitionEvent,
  ): Promise<void> {
    const { error: recordError } = await this.client
      .from('certification_records')
      .insert(toRow(record));
    if (recordError) {
      throw new Error(`certification record insert failed: ${recordError.message}`);
    }

    const { error: eventError } = await this.client
      .from('certification_transition_events')
      .insert(toEventRow(event));
    if (eventError) {
      throw new Error(`certification transition-event insert failed: ${eventError.message}`);
    }
  }

  async insertPropagationBatch(results: TransitionResult[]): Promise<void> {
    if (results.length === 0) {
      return;
    }

    const { error } = await this.client.rpc(
      'insert_certification_propagation_batch',
      {
        p_records: results.map(result => toRow(result.record)),
        p_events: results.map(result => toEventRow(result.event)),
      },
    );

    if (error) {
      throw new Error(`certification propagation batch insert failed: ${error.message}`);
    }
  }

  async insertGateEvent(event: DependentGateEvent): Promise<void> {
    const { error } = await this.client
      .from('audit_log')
      .insert({
        entity_type: 'certification_gate',
        entity_id: null,
        entity_ref: `${event.programId}:${event.domain}`,
        action: event.verdict === 'allowed' ? 'certification.gate.allowed' : 'certification.gate.denied',
        actor: 'certification-lifecycle-manager',
        payload: {
          ...event,
          blockers: [...event.blockers],
          dependenciesChecked: [...event.dependenciesChecked],
        },
      });

    if (error) {
      throw new Error(`certification gate-event insert failed: ${error.message}`);
    }
  }

  async insertPropagationAuditEvent(event: PropagationAuditEvent): Promise<void> {
    const { error } = await this.client
      .from('audit_log')
      .insert({
        entity_type: 'certification_propagation',
        entity_id: null,
        entity_ref: `${event.programId}:${event.domain}`,
        action: event.action,
        actor: 'certification-lifecycle-manager',
        payload: event,
      });

    if (error) {
      throw new Error(`certification propagation audit insert failed: ${error.message}`);
    }
  }
}

export interface ProductionCertificationRuntime {
  repository: DatabaseCertificationRepository;
  manager: CertificationLifecycleManager;
  wiring: RevocationTriggerWiring;
}

export function createProductionCertificationRuntime(
  connection: DatabaseConnectionConfig,
): ProductionCertificationRuntime {
  const repository = new DatabaseCertificationRepository(
    createDatabaseClientFromConnection(connection),
  );
  const manager = new CertificationLifecycleManager(repository);
  return {
    repository,
    manager,
    wiring: new RevocationTriggerWiring(manager),
  };
}

export async function invalidateExpiredCertificationProofs(
  runtime: ProductionCertificationRuntime,
  options: {
    programId?: ProgramId;
    now?: string;
  } = {},
): Promise<CertificationDomain[]> {
  const programId = options.programId ?? 'P1';
  const now = options.now ?? new Date().toISOString();
  const current = await runtime.repository.getAllCurrentRecords(programId);
  const invalidated: CertificationDomain[] = [];

  for (const domain of ['proof_lineage', 'freshness'] as const) {
    const record = current[domain];
    if (!record || record.status !== 'active' || record.expiresAt === null || record.expiresAt > now) {
      continue;
    }

    if (domain === 'proof_lineage') {
      await runtime.wiring.triggerStaleProofLineage(
        programId,
        record.evidenceSha,
        record.mergeSha,
        `certification domain ${domain} expired at ${record.expiresAt}`,
      );
    } else {
      await runtime.manager.onFreshnessEnforcementFailure(
        programId,
        record.evidenceSha,
        record.mergeSha,
        `certification domain ${domain} expired at ${record.expiresAt}`,
      );
    }
    invalidated.push(domain);
  }

  return invalidated;
}
