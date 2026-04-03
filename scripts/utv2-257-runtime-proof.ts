type UnknownRecord = Record<string, unknown>;

type PickProof = {
  id: string;
  status: string | null;
  submissionMode: string | null;
  submittedBy: string | null;
  visibleFields: {
    domainAnalysis: boolean;
    realEdge: boolean;
    realEdgeSource: boolean;
    kellyFraction: boolean;
    kellySizing: boolean;
    deviggingResult: boolean;
    promotionScores: boolean;
    trustScore: number | null;
    capperConviction: number | null;
    selectedOffer: boolean;
  };
  trustMapping: 'VALID' | 'INVALID' | 'MISSING';
};

type ProofOutput = {
  ok: boolean;
  fetchedAt: string;
  searchEndpoint: string;
  detailEndpoint: string | null;
  inspectedSmartFormPicks: number;
  liveOfferPicks: number;
  proofVerdict: 'PROVEN' | 'NOT_PROVEN';
  summary: {
    domainAnalysisVisible: number;
    realEdgeVisible: number;
    realEdgeSourceVisible: number;
    trustMappingValid: number;
    selectedOfferVisible: number;
    detailSurfaceVerified: boolean;
  };
  picks: PickProof[];
  detailSample?: {
    pickId: string;
    intelligenceVisible: {
      realEdge: boolean;
      realEdgeSource: boolean;
      domainAnalysis: boolean;
      promotionScores: boolean;
    };
  };
  error?: string;
};

const SEARCH_URL = 'http://localhost:4200/api/operator/pick-search?source=smart-form&limit=25';

void main();

async function main(): Promise<void> {
  const output = await buildProofOutput();
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

async function buildProofOutput(): Promise<ProofOutput> {
  try {
    const searchResponse = await fetch(SEARCH_URL, {
      headers: { accept: 'application/json' },
    });

    if (!searchResponse.ok) {
      return buildErrorOutput(`Pick search failed with HTTP ${searchResponse.status}`);
    }

    const searchPayload = (await searchResponse.json()) as unknown;
    const allPicks = readPicks(searchPayload);
    const smartFormPicks = allPicks.filter(isSmartFormPick);
    const liveOfferPicks = smartFormPicks
      .filter((pick) => readSubmissionMode(pick) === 'live-offer')
      .slice(0, 5);

    const picks = liveOfferPicks.map(buildPickProof);
    const detailSampleId = picks[0]?.id ?? null;
    const detailSample = detailSampleId ? await fetchDetailProof(detailSampleId) : null;

    const summary = {
      domainAnalysisVisible: picks.filter((pick) => pick.visibleFields.domainAnalysis).length,
      realEdgeVisible: picks.filter((pick) => pick.visibleFields.realEdge).length,
      realEdgeSourceVisible: picks.filter((pick) => pick.visibleFields.realEdgeSource).length,
      trustMappingValid: picks.filter((pick) => pick.trustMapping === 'VALID').length,
      selectedOfferVisible: picks.filter((pick) => pick.visibleFields.selectedOffer).length,
      detailSurfaceVerified: detailSample !== null,
    };

    const proofVerdict =
      picks.length > 0 &&
      summary.domainAnalysisVisible > 0 &&
      summary.realEdgeVisible > 0 &&
      summary.realEdgeSourceVisible > 0 &&
      summary.trustMappingValid > 0
        ? 'PROVEN'
        : 'NOT_PROVEN';

    return {
      ok: true,
      fetchedAt: new Date().toISOString(),
      searchEndpoint: SEARCH_URL,
      detailEndpoint: detailSampleId
        ? `http://localhost:4200/api/operator/picks/${encodeURIComponent(detailSampleId)}`
        : null,
      inspectedSmartFormPicks: smartFormPicks.length,
      liveOfferPicks: liveOfferPicks.length,
      proofVerdict,
      summary,
      picks,
      detailSample: detailSample ?? undefined,
    };
  } catch (error) {
    return buildErrorOutput(error instanceof Error ? error.message : String(error));
  }
}

async function fetchDetailProof(pickId: string): Promise<ProofOutput['detailSample'] | null> {
  const detailUrl = `http://localhost:4200/api/operator/picks/${encodeURIComponent(pickId)}`;
  const response = await fetch(detailUrl, {
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as unknown;
  const detailRecord = extractDetailPick(payload);
  const metadata = asRecord(detailRecord?.['metadata']);
  const domainAnalysis = asRecord(metadata['domainAnalysis']);

  return {
    pickId,
    intelligenceVisible: {
      realEdge: hasValue(metadata['realEdge']) || hasValue(domainAnalysis['realEdge']),
      realEdgeSource:
        hasValue(metadata['realEdgeSource']) ||
        hasValue(domainAnalysis['realEdgeSource']) ||
        hasValue(metadata['edgeSource']),
      domainAnalysis: hasValue(metadata['domainAnalysis']),
      promotionScores: hasValue(metadata['promotionScores']),
    },
  };
}

function readPicks(payload: unknown): Array<Record<string, unknown>> {
  if (!isRecord(payload)) {
    return [];
  }

  const data = asRecord(payload['data']);
  const picks = data['picks'];
  return Array.isArray(picks)
    ? picks.filter((pick): pick is Record<string, unknown> => isRecord(pick))
    : [];
}

function isSmartFormPick(pick: Record<string, unknown>): boolean {
  return pick['source'] === 'smart-form';
}

function readSubmissionMode(pick: Record<string, unknown>): string | null {
  const metadata = asRecord(pick['metadata']);
  return readString(metadata['submissionMode']);
}

function buildPickProof(pick: Record<string, unknown>): PickProof {
  const metadata = asRecord(pick['metadata']);
  const domainAnalysis = asRecord(metadata['domainAnalysis']);
  const promotionScores = asRecord(metadata['promotionScores']);
  const trustScore = readNumber(promotionScores['trust']);
  const capperConviction = readNumber(metadata['capperConviction']);

  return {
    id: readString(pick['id']) ?? 'unknown',
    status: readString(pick['status']),
    submissionMode: readString(metadata['submissionMode']),
    submittedBy: readString(pick['submitter']) ?? readString(metadata['capper']),
    visibleFields: {
      domainAnalysis: hasValue(metadata['domainAnalysis']),
      realEdge: hasValue(metadata['realEdge']) || hasValue(domainAnalysis['realEdge']),
      realEdgeSource:
        hasValue(metadata['realEdgeSource']) ||
        hasValue(domainAnalysis['realEdgeSource']) ||
        hasValue(metadata['edgeSource']),
      kellyFraction: hasValue(domainAnalysis['kellyFraction']),
      kellySizing: hasValue(metadata['kellySizing']),
      deviggingResult: hasValue(metadata['deviggingResult']),
      promotionScores: hasValue(metadata['promotionScores']),
      trustScore,
      capperConviction,
      selectedOffer: hasValue(metadata['selectedOffer']),
    },
    trustMapping: buildTrustMappingVerdict(trustScore, capperConviction),
  };
}

function buildTrustMappingVerdict(
  trustScore: number | null,
  capperConviction: number | null,
): PickProof['trustMapping'] {
  if (trustScore == null || capperConviction == null) {
    return 'MISSING';
  }

  return trustScore === capperConviction * 10 ? 'VALID' : 'INVALID';
}

function extractDetailPick(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) {
    return null;
  }

  const data = asRecord(payload['data']);
  const pick = data['pick'];
  return isRecord(pick) ? pick : null;
}

function buildErrorOutput(error: string): ProofOutput {
  return {
    ok: false,
    fetchedAt: new Date().toISOString(),
    searchEndpoint: SEARCH_URL,
    detailEndpoint: null,
    inspectedSmartFormPicks: 0,
    liveOfferPicks: 0,
    proofVerdict: 'NOT_PROVEN',
    summary: {
      domainAnalysisVisible: 0,
      realEdgeVisible: 0,
      realEdgeSourceVisible: 0,
      trustMappingValid: 0,
      selectedOfferVisible: 0,
      detailSurfaceVerified: false,
    },
    picks: [],
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

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
