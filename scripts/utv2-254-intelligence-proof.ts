type UnknownRecord = Record<string, unknown>;

type FieldPresence = {
  domainAnalysis: boolean;
  realEdge: boolean;
  realEdgeSource: boolean;
  deviggingResult: boolean;
  kellySizing: boolean;
  promotionScores: boolean;
};

type PickVerdict = {
  id: string | null;
  status: string | null;
  verdict: 'COMPLETE' | 'INCOMPLETE';
  fields: FieldPresence;
};

type Summary = {
  inspectedPickCount: number;
  completePickCount: number;
  fieldPresenceCounts: Record<keyof FieldPresence, number>;
};

type ProofOutput = {
  ok: boolean;
  endpoint: string;
  fetchedAt: string;
  totalRecentPicksSeen: number;
  inspectedPickCount: number;
  picks: PickVerdict[];
  summary: Summary;
  error?: string;
};

const SNAPSHOT_URL = 'http://localhost:4200/api/operator/snapshot';

void main();

async function main(): Promise<void> {
  const output = await buildProofOutput();
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exit(0);
}

async function buildProofOutput(): Promise<ProofOutput> {
  try {
    const response = await fetch(SNAPSHOT_URL, {
      headers: {
        accept: 'application/json',
      },
    });

    if (!response.ok) {
      return buildErrorOutput(`Snapshot request failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    const recentPicks = getRecentPicks(payload);
    const lastFivePicks = recentPicks.slice(-5);
    const picks = lastFivePicks.map(buildPickVerdict);

    return {
      ok: true,
      endpoint: SNAPSHOT_URL,
      fetchedAt: new Date().toISOString(),
      totalRecentPicksSeen: recentPicks.length,
      inspectedPickCount: picks.length,
      picks,
      summary: buildSummary(picks),
    };
  } catch (error) {
    return buildErrorOutput(error instanceof Error ? error.message : String(error));
  }
}

function getRecentPicks(payload: unknown): unknown[] {
  if (!isRecord(payload)) {
    return [];
  }

  // Unwrap {ok: true, data: {...}} envelope if present
  const inner = isRecord(payload['data']) ? payload['data'] : payload;
  const recentPicks = inner['recentPicks'];
  return Array.isArray(recentPicks) ? recentPicks : [];
}

function buildPickVerdict(pick: unknown): PickVerdict {
  const pickRecord = isRecord(pick) ? pick : {};
  const metadata = asRecord(pickRecord['metadata']);
  const domainAnalysis = asRecord(metadata['domainAnalysis']);

  const fields: FieldPresence = {
    domainAnalysis: hasValue(metadata['domainAnalysis']),
    realEdge: hasValue(domainAnalysis['realEdge']) || hasValue(metadata['realEdge']),
    realEdgeSource:
      hasValue(domainAnalysis['realEdgeSource']) || hasValue(metadata['edgeSource']),
    deviggingResult: hasValue(metadata['deviggingResult']),
    kellySizing: hasValue(metadata['kellySizing']),
    promotionScores: hasValue(metadata['promotionScores']),
  };

  return {
    id: readStringishId(pickRecord['id']),
    status: readOptionalString(pickRecord['status']),
    verdict: Object.values(fields).every(Boolean) ? 'COMPLETE' : 'INCOMPLETE',
    fields,
  };
}

function buildSummary(picks: PickVerdict[]): Summary {
  const fieldPresenceCounts: Record<keyof FieldPresence, number> = {
    domainAnalysis: 0,
    realEdge: 0,
    realEdgeSource: 0,
    deviggingResult: 0,
    kellySizing: 0,
    promotionScores: 0,
  };

  let completePickCount = 0;

  for (const pick of picks) {
    if (pick.verdict === 'COMPLETE') {
      completePickCount += 1;
    }

    for (const key of Object.keys(fieldPresenceCounts) as Array<keyof FieldPresence>) {
      if (pick.fields[key]) {
        fieldPresenceCounts[key] += 1;
      }
    }
  }

  return {
    inspectedPickCount: picks.length,
    completePickCount,
    fieldPresenceCounts,
  };
}

function buildErrorOutput(error: string): ProofOutput {
  const picks: PickVerdict[] = [];

  return {
    ok: false,
    endpoint: SNAPSHOT_URL,
    fetchedAt: new Date().toISOString(),
    totalRecentPicksSeen: 0,
    inspectedPickCount: 0,
    picks,
    summary: buildSummary(picks),
    error,
  };
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function hasValue(value: unknown): boolean {
  if (value == null) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  return true;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readStringishId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }

  return null;
}
