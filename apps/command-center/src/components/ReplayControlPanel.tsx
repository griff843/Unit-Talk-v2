'use client';

import type { EventStreamRecord } from '@/lib/events-feed';

interface ReplayControlPanelProps {
  events: readonly EventStreamRecord[];
  bufferedCount: number;
  paused: boolean;
  onJumpToLatest: () => void;
  onApplyBuffered: () => void;
}

const SPEED_PRESETS = ['0.5x', '1.0x', '2.0x'] as const;

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function ReplayControlPanel({
  events,
  bufferedCount,
  paused,
  onJumpToLatest,
  onApplyBuffered,
}: ReplayControlPanelProps) {
  const recentEvents = events.slice(0, 6);

  return (
    <div className="flex h-full flex-col gap-5 rounded-[1.5rem] border border-cyan-400/20 bg-slate-950/90 p-5 shadow-[0_20px_80px_rgba(8,145,178,0.18)] backdrop-blur">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-cyan-300/80">
            Replay Mode
          </p>
          <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-medium text-cyan-100">
            read-only
          </span>
        </div>
        <h2 className="text-lg font-semibold text-white">Stream playback controls</h2>
        <p className="text-sm leading-6 text-slate-400">
          This panel wraps the event feed in operator-safe replay controls without changing runtime truth.
        </p>
      </div>

      <div className="grid gap-3 rounded-2xl border border-white/5 bg-white/[0.03] p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">Playback state</span>
          <span className={paused ? 'font-semibold text-amber-300' : 'font-semibold text-emerald-300'}>
            {paused ? 'Paused' : 'Live'}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">Buffered events</span>
          <span className="font-semibold text-white">{bufferedCount}</span>
        </div>
        <div className="flex gap-2">
          {SPEED_PRESETS.map((speed) => (
            <div
              key={speed}
              className={`rounded-full border px-3 py-1 text-xs ${
                speed === '1.0x'
                  ? 'border-cyan-400/50 bg-cyan-400/10 text-cyan-100'
                  : 'border-white/10 bg-white/[0.02] text-slate-400'
              }`}
            >
              {speed}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onJumpToLatest}
            className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-medium text-slate-100 transition-colors hover:border-cyan-300/40 hover:text-white"
          >
            Jump to latest
          </button>
          <button
            type="button"
            onClick={onApplyBuffered}
            className="flex-1 rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 text-sm font-medium text-cyan-100 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={bufferedCount === 0}
          >
            Apply buffer
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Recent sequence</h3>
          <span className="text-[11px] uppercase tracking-[0.2em] text-slate-500">last 6</span>
        </div>
        <div className="space-y-2">
          {recentEvents.length === 0 ? (
            <p className="text-sm text-slate-500">No events loaded yet.</p>
          ) : (
            recentEvents.map((event) => (
              <div key={event.id} className="rounded-xl border border-white/5 bg-slate-900/70 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-100">{event.type}</span>
                  <span className="text-xs text-slate-500">{formatTime(event.timestamp)}</span>
                </div>
                <p className="mt-1 text-xs text-slate-400">{event.source}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
