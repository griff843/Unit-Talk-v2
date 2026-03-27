import type { CatalogData } from './catalog';

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4000';

export interface SubmitPickPayload {
  source: string;
  submittedBy?: string;
  market: string;
  selection: string;
  line?: number;
  odds?: number;
  stakeUnits?: number;
  confidence?: number;
  eventName?: string;
  metadata?: Record<string, unknown>;
}

export interface SubmitPickResult {
  submissionId: string;
  pickId: string;
  lifecycleState: string;
}

export async function getCatalog(): Promise<CatalogData> {
  const res = await fetch(`${API}/api/reference-data/catalog`);
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message ?? `Reference data unavailable: ${res.status}`);
  }
  return json.data as CatalogData;
}

export async function submitPick(payload: SubmitPickPayload): Promise<SubmitPickResult> {
  const res = await fetch(`${API}/api/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message ?? `Submit failed: ${res.status}`);
  }
  return json.data as SubmitPickResult;
}
