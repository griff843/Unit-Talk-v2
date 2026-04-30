import { AutoRefreshStatusBar } from '@/hooks/useAutoRefresh';
import { getSnapshotData } from '@/lib/data';
import { buildEventFeedData } from '@/lib/command-center-page-data';
import { EventsPageClient } from '@/components/EventsPageClient';

export default async function EventsPage() {
  const snapshot = await getSnapshotData();
  const events = buildEventFeedData(snapshot);
  const observedAt = new Date().toISOString();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-lg font-bold text-gray-100">Events</h1>
          <p className="text-sm text-gray-500">
            Live runtime feed spanning recent runs, incidents, health signals, and audit activity.
          </p>
        </div>
        <AutoRefreshStatusBar lastUpdatedAt={observedAt} intervalMs={30_000} className="lg:min-w-[360px]" />
      </div>

      <EventsPageClient initialEvents={events} />
    </div>
  );
}
