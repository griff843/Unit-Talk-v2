import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  resolveApiBaseUrl,
  resolveCommandCenterApiHeaders,
} from '@/lib/server-api';

type ModelHealthAction = 'acknowledge' | 'demote' | 'retire';

interface ModelHealthSnapshotRecord {
  id: string;
  model_id: string;
  sport: string;
  market_family: string;
  alert_level: string;
  snapshot_at: string;
  created_at: string;
  metadata: unknown;
}

type ModelHealthFetchResult =
  | { ok: true; records: ModelHealthSnapshotRecord[] }
  | { ok: false; error: string };

const API_BASE = resolveApiBaseUrl();
const DECISION_ACTIONS: ModelHealthAction[] = ['acknowledge', 'demote', 'retire'];

async function fetchModelHealthAlerts(): Promise<ModelHealthFetchResult> {
  try {
    const res = await fetch(`${API_BASE}/api/model-health/alerts`, {
      cache: 'no-store',
      headers: resolveCommandCenterApiHeaders(),
    });
    const body = await res.json().catch(() => null) as unknown;

    if (!res.ok) {
      return { ok: false, error: readErrorMessage(body) ?? `Model health fetch failed: ${res.status}` };
    }

    if (Array.isArray(body)) {
      return { ok: true, records: body as ModelHealthSnapshotRecord[] };
    }

    const record = readRecord(body);
    if (record.ok === true && Array.isArray(record.data)) {
      return { ok: true, records: record.data as ModelHealthSnapshotRecord[] };
    }

    return { ok: false, error: 'Model health response was not an alert array.' };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Model health fetch failed.',
    };
  }
}

async function submitModelHealthDecision(formData: FormData) {
  'use server';

  const modelId = String(formData.get('modelId') ?? '').trim();
  const action = String(formData.get('action') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();

  if (!modelId || !isModelHealthAction(action) || !reason) {
    redirect('/model-health?error=Model%20ID%2C%20action%2C%20and%20reason%20are%20required.');
  }

  const res = await fetch(`${API_BASE}/api/model-health/decision`, {
    method: 'POST',
    headers: resolveCommandCenterApiHeaders(),
    body: JSON.stringify({ modelId, action, reason, actor: 'operator' }),
  });
  const body = await res.json().catch(() => null) as unknown;
  if (!res.ok) {
    const message = readErrorMessage(body) ?? `Model health decision failed: ${res.status}`;
    redirect(`/model-health?error=${encodeURIComponent(message)}`);
  }

  revalidatePath('/model-health');
  redirect('/model-health?decision=recorded');
}

export default async function ModelHealthPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const result = await fetchModelHealthAlerts();
  const error = typeof searchParams?.error === 'string' ? searchParams.error : null;
  const decision = typeof searchParams?.decision === 'string' ? searchParams.decision : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Operations</p>
        <h1 className="text-xl font-bold text-white">Model Health Alerts</h1>
        <p className="max-w-3xl text-sm text-gray-400">
          Review alerted model health snapshots and record operator decisions for models requiring attention.
        </p>
      </div>

      {error && (
        <div className="rounded border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}
      {decision === 'recorded' && (
        <div className="rounded border border-emerald-800 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
          Model health decision recorded.
        </div>
      )}

      {!result.ok ? (
        <div className="rounded border border-yellow-800 bg-yellow-950/30 px-4 py-5">
          <h2 className="text-sm font-semibold text-yellow-200">Unable to load model health alerts</h2>
          <p className="mt-2 text-sm text-yellow-100/80">{result.error}</p>
        </div>
      ) : result.records.length === 0 ? (
        <div className="rounded border border-gray-800 bg-gray-900/50 px-4 py-8 text-center">
          <h2 className="text-sm font-semibold text-gray-200">No alerted models</h2>
          <p className="mt-2 text-sm text-gray-500">Model health snapshots currently report no active alerts.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-gray-800">
          <table className="min-w-full divide-y divide-gray-800 text-sm">
            <thead className="bg-gray-900/80 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Model</th>
                <th scope="col" className="px-4 py-3 font-medium">Alert Level</th>
                <th scope="col" className="px-4 py-3 font-medium">Decision Required</th>
                <th scope="col" className="px-4 py-3 font-medium">Last Scan</th>
                <th scope="col" className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800 bg-gray-950">
              {result.records.map((snapshot) => (
                <tr key={snapshot.id} className="align-top">
                  <td className="px-4 py-4">
                    <div className="font-medium text-gray-100">{readModelName(snapshot)}</div>
                    <div className="mt-1 font-mono text-xs text-gray-500">{snapshot.model_id}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      {snapshot.sport} / {snapshot.market_family}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium ${alertLevelClass(snapshot.alert_level)}`}>
                      {snapshot.alert_level}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium ${decisionRequiredClass(readRequiresOperatorDecision(snapshot))}`}>
                      {readRequiresOperatorDecision(snapshot) ? 'Required' : 'Cleared'}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-gray-300">
                    <time dateTime={snapshot.snapshot_at}>{formatTimestamp(snapshot.snapshot_at)}</time>
                  </td>
                  <td className="px-4 py-4">
                    <form action={submitModelHealthDecision} className="flex min-w-[260px] flex-col gap-2">
                      <input type="hidden" name="modelId" value={snapshot.model_id} />
                      <label htmlFor={`action-${snapshot.id}`} className="sr-only">Action</label>
                      <select
                        id={`action-${snapshot.id}`}
                        name="action"
                        defaultValue="acknowledge"
                        className="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        {DECISION_ACTIONS.map((action) => (
                          <option key={action} value={action}>{action}</option>
                        ))}
                      </select>
                      <label htmlFor={`reason-${snapshot.id}`} className="sr-only">Reason</label>
                      <textarea
                        id={`reason-${snapshot.id}`}
                        name="reason"
                        rows={2}
                        required
                        placeholder="Reason..."
                        className="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <button
                        type="submit"
                        className="rounded bg-blue-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-gray-950"
                      >
                        Submit Decision
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function readModelName(snapshot: ModelHealthSnapshotRecord): string {
  const metadata = readRecord(snapshot.metadata);
  const candidates = [metadata.modelName, metadata.model_name, metadata.name];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return snapshot.model_id;
}

function readRequiresOperatorDecision(snapshot: ModelHealthSnapshotRecord): boolean {
  const metadata = readRecord(snapshot.metadata);
  return metadata.requiresOperatorDecision === true;
}

function readErrorMessage(body: unknown): string | null {
  const record = readRecord(body);
  const error = readRecord(record.error);
  return typeof error.message === 'string' ? error.message : null;
}

function readRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function isModelHealthAction(action: string): action is ModelHealthAction {
  return DECISION_ACTIONS.includes(action as ModelHealthAction);
}

function formatTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function alertLevelClass(level: string): string {
  if (level === 'critical') return 'border-red-800 bg-red-950/50 text-red-200';
  if (level === 'warning') return 'border-yellow-800 bg-yellow-950/50 text-yellow-200';
  return 'border-gray-700 bg-gray-800 text-gray-300';
}

function decisionRequiredClass(required: boolean): string {
  return required
    ? 'border-red-800 bg-red-950/50 text-red-200'
    : 'border-gray-700 bg-gray-800 text-gray-300';
}
