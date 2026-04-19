import { EmptyState } from '@/components/ui/EmptyState';
import { fetchRoutingPreview } from '@/lib/api';

interface RoutingPreviewPageProps {
  searchParams?: {
    pickId?: string;
  };
}

export default async function RoutingPreviewPage({ searchParams }: RoutingPreviewPageProps) {
  const pickId = searchParams?.pickId?.trim() ?? '';
  const preview = pickId ? await loadRoutingPreview(pickId) : null;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Decision</p>
        <h1 className="text-xl font-bold text-white">Routing Preview</h1>
      </div>

      <form className="flex flex-col gap-3 sm:flex-row" action="/decision/routing">
        <label className="sr-only" htmlFor="pickId">Pick ID</label>
        <input
          id="pickId"
          name="pickId"
          defaultValue={pickId}
          className="min-h-10 flex-1 rounded border border-gray-700 bg-gray-950 px-3 text-sm text-white outline-none focus:border-cyan-500"
          placeholder="Enter pick ID"
        />
        <button
          type="submit"
          className="min-h-10 rounded border border-cyan-500/40 bg-cyan-500/10 px-4 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/20"
        >
          Search
        </button>
      </form>

      {!pickId ? (
        <EmptyState message="Enter a pick ID" detail="Routing preview resolves promotion target, distribution target, and outbox state." />
      ) : preview?.ok ? (
        <section className="grid gap-3 md:grid-cols-2">
          <PreviewField label="Distribution target" value={preview.data.distributionTarget ?? 'None'} />
          <PreviewField label="Promotion target" value={preview.data.promotionTarget ?? 'None'} />
          <PreviewField label="Pick status" value={preview.data.status} />
          <PreviewField label="Outbox status" value={preview.data.outboxStatus} />
          <div className="md:col-span-2 rounded border border-gray-800 bg-gray-900/40 p-4">
            <p className="text-xs uppercase tracking-widest text-gray-500">Routing reason</p>
            <p className="mt-2 text-sm text-gray-200">{preview.data.routingReason}</p>
          </div>
        </section>
      ) : (
        <div className="rounded border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {preview?.error ?? 'Routing preview failed'}
        </div>
      )}
    </div>
  );
}

async function loadRoutingPreview(pickId: string) {
  try {
    return { ok: true as const, data: await fetchRoutingPreview(pickId) };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

function PreviewField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-gray-800 bg-gray-900/40 p-4">
      <p className="text-xs uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-2 break-words text-sm font-semibold text-white">{value}</p>
    </div>
  );
}
