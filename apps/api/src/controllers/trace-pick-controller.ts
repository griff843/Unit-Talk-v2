import type {
  AuditLogRepository,
  AuditLogRow,
  OutboxRecord,
  PickLifecycleRecord,
  PickRecord,
  PromotionHistoryRecord,
  ReceiptRecord,
  RepositoryBundle,
  SubmissionEventRecord,
  SettlementRecord,
} from '@unit-talk/db';

interface ApiSuccessResponse {
  ok: true;
  data: {
    pick: PickRecord;
    submissionEvents: SubmissionEventRecord[];
    promotionHistory: PromotionHistoryRecord[];
    outboxEntries: OutboxRecord[];
    distributionReceipts: ReceiptRecord[];
    settlementRecords: SettlementRecord[];
    auditLogEntries: AuditLogRow[];
    lifecycleEvents: PickLifecycleRecord[];
  };
}

interface ApiErrorResponse {
  ok: false;
  error: {
    code: 'PICK_NOT_FOUND';
    message: string;
  };
}

type ApiResponse = {
  status: number;
  body: ApiSuccessResponse | ApiErrorResponse;
};

type SupabaseLikeClient = {
  from(table: string): {
    select(query: string): {
      eq(column: string, value: string): {
        order(
          column: string,
          options?: { ascending?: boolean },
        ): Promise<{ data: unknown[] | null; error: { message: string } | null }>;
      };
    };
  };
};

export async function tracePickController(
  pickId: string,
  repositories: RepositoryBundle,
): Promise<ApiResponse> {
  const pick = await repositories.picks.findPickById(pickId);
  if (!pick) {
    return {
      status: 404,
      body: {
        ok: false,
        error: {
          code: 'PICK_NOT_FOUND',
          message: `Pick not found: ${pickId}`,
        },
      },
    };
  }

  const submissionId = pick.submission_id ?? pick.id;
  const [submissionEvents, promotionHistory, outboxEntries, settlementRecords, auditLogEntries, lifecycleEvents] =
    await Promise.all([
      listSubmissionEvents(repositories, submissionId),
      listPromotionHistory(repositories, pick.id),
      repositories.outbox.listByPickId(pick.id),
      repositories.settlements.listByPick(pick.id),
      listAuditLogEntries(repositories.audit, pick.id),
      listLifecycleEvents(repositories, pick.id),
    ]);

  const distributionReceipts = (
    await Promise.all(
      outboxEntries.map(async (entry) => repositories.receipts.findLatestByOutboxId(entry.id)),
    )
  ).filter((receipt): receipt is ReceiptRecord => receipt !== null);

  return {
    status: 200,
    body: {
      ok: true,
      data: {
        pick,
        submissionEvents,
        promotionHistory,
        outboxEntries,
        distributionReceipts,
        settlementRecords,
        auditLogEntries,
        lifecycleEvents,
      },
    },
  };
}

async function listSubmissionEvents(
  repositories: RepositoryBundle,
  submissionId: string,
): Promise<SubmissionEventRecord[]> {
  const inMemoryRepository = repositories.submissions as {
    submissionEvents?: SubmissionEventRecord[];
  };
  if (Array.isArray(inMemoryRepository.submissionEvents)) {
    return inMemoryRepository.submissionEvents
      .filter((event) => event.submission_id === submissionId)
      .sort((left, right) => left.created_at.localeCompare(right.created_at));
  }

  const client = readSupabaseClient(repositories.submissions);
  return queryByKey<SubmissionEventRecord>(client, 'submission_events', 'submission_id', submissionId);
}

async function listPromotionHistory(
  repositories: RepositoryBundle,
  pickId: string,
): Promise<PromotionHistoryRecord[]> {
  const inMemoryRepository = repositories.picks as {
    promotionHistory?: PromotionHistoryRecord[];
  };
  if (Array.isArray(inMemoryRepository.promotionHistory)) {
    return inMemoryRepository.promotionHistory
      .filter((event) => event.pick_id === pickId)
      .sort((left, right) => left.created_at.localeCompare(right.created_at));
  }

  const client = readSupabaseClient(repositories.picks);
  return queryByKey<PromotionHistoryRecord>(client, 'pick_promotion_history', 'pick_id', pickId);
}

async function listLifecycleEvents(
  repositories: RepositoryBundle,
  pickId: string,
): Promise<PickLifecycleRecord[]> {
  const inMemoryRepository = repositories.picks as {
    lifecycleEvents?: PickLifecycleRecord[];
  };
  if (Array.isArray(inMemoryRepository.lifecycleEvents)) {
    return inMemoryRepository.lifecycleEvents
      .filter((event) => event.pick_id === pickId)
      .sort((left, right) => left.created_at.localeCompare(right.created_at));
  }

  const client = readSupabaseClient(repositories.picks);
  return queryByKey<PickLifecycleRecord>(client, 'pick_lifecycle', 'pick_id', pickId);
}

async function listAuditLogEntries(
  repository: AuditLogRepository,
  pickId: string,
): Promise<AuditLogRow[]> {
  const inMemoryRepository = repository as {
    records?: AuditLogRow[];
  };
  if (Array.isArray(inMemoryRepository.records)) {
    return inMemoryRepository.records
      .filter((record) => record.entity_ref === pickId)
      .sort((left, right) => left.created_at.localeCompare(right.created_at));
  }

  const client = readSupabaseClient(repository);
  return queryByKey<AuditLogRow>(client, 'audit_log', 'entity_ref', pickId);
}

function readSupabaseClient(repository: object): SupabaseLikeClient {
  const candidate = repository as { client?: SupabaseLikeClient };
  if (!candidate.client) {
    throw new Error('Repository does not expose a readable client for trace queries.');
  }

  return candidate.client;
}

async function queryByKey<T>(
  client: SupabaseLikeClient,
  table: string,
  key: string,
  value: string,
): Promise<T[]> {
  const { data, error } = await client
    .from(table)
    .select('*')
    .eq(key, value)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to query ${table}: ${error.message}`);
  }

  return (data ?? []) as T[];
}
