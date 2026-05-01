import { EventsWorkspace } from '@/components/EventsWorkspace';
import { getEventStream } from '@/lib/data/events';

export default async function EventsPage() {
  const { events, observedAt } = await getEventStream(250);

  return <EventsWorkspace initialEvents={events} observedAt={observedAt} />;
}
