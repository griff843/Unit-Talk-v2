'use client';

import React, { useState } from 'react';
import { DetailPanel, LiveEventFeed } from '@/components/ui';
import type { CommandCenterEvent } from '@/lib/command-center-page-data';
import type { LiveEventFeedEvent } from '@/components/ui';

export interface EventsPageClientProps {
  initialEvents: CommandCenterEvent[];
}

export function EventsPageClient({ initialEvents }: EventsPageClientProps) {
  const [paused, setPaused] = useState(false);
  const [selectedEventType, setSelectedEventType] = useState<string | null>(null);
  const [replayMode, setReplayMode] = useState(false);

  const filteredEvents: LiveEventFeedEvent[] = (selectedEventType
    ? initialEvents.filter(e => e.type === selectedEventType)
    : initialEvents
  ).map(e => ({
    id: e.id,
    title: e.title,
    detail: e.detail,
    timestamp: e.timestamp,
    tone: e.tone,
  }));

  const eventTypes = Array.from(new Set(initialEvents.map(e => e.type)));

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <LiveEventFeed
          events={filteredEvents}
          paused={paused}
          onTogglePause={() => setPaused(!paused)}
        />
      </div>
      <DetailPanel title="Event Controls" defaultOpen>
        <div className="space-y-4">
          <div>
            <button
              onClick={() => setPaused(!paused)}
              className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              {paused ? 'Play' : 'Pause'}
            </button>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-2">Filter by Type</label>
            <select
              value={selectedEventType ?? ''}
              onChange={(e) => setSelectedEventType(e.target.value || null)}
              className="w-full rounded bg-white/[0.06] px-3 py-2 text-sm text-gray-100"
            >
              <option value="">All Events</option>
              {eventTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={replayMode}
                onChange={(e) => setReplayMode(e.target.checked)}
                className="rounded"
              />
              <span className="text-xs font-semibold text-gray-100">Replay Mode</span>
            </label>
          </div>
        </div>
      </DetailPanel>
    </div>
  );
}
