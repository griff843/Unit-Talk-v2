'use client';

import React from 'react';
import type { CommandCenterEvent } from '@/lib/command-center-page-data';

export interface ReplayControlPanelProps {
  events: CommandCenterEvent[];
  currentIndex: number;
  onNavigate: (index: number) => void;
}

export function ReplayControlPanel({ events, currentIndex, onNavigate }: ReplayControlPanelProps) {
  return (
    <div className="space-y-3 rounded bg-white/[0.06] p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-400">Event Replay</span>
        <span className="text-xs text-gray-500">{currentIndex + 1} / {events.length}</span>
      </div>
      <div className="max-h-48 overflow-y-auto space-y-2 rounded bg-white/[0.03] p-3">
        {events.map((event, idx) => (
          <button
            key={idx}
            onClick={() => onNavigate(idx)}
            className={`w-full text-left rounded px-3 py-2 text-xs transition-colors ${
              idx === currentIndex
                ? 'bg-blue-600/40 text-blue-100'
                : 'bg-white/[0.06] text-gray-300 hover:bg-white/[0.1]'
            }`}
          >
            <div className="font-semibold">{event.type}</div>
            <div className="text-[11px] text-gray-500 mt-1">{event.timestamp}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
