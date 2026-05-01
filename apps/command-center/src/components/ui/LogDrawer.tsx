'use client';

import React, { useEffect } from 'react';
import { useAgentLogs } from '../../hooks/useAgentLogs';

export interface LogDrawerProps {
  agentId: string;
  open: boolean;
  onClose: () => void;
}

function levelTone(level: 'info' | 'warning' | 'error') {
  if (level === 'error') return 'text-rose-300';
  if (level === 'warning') return 'text-amber-200';
  return 'text-sky-200';
}

export function LogDrawer({ agentId, open, onClose }: LogDrawerProps) {
  const { entries, status } = useAgentLogs(agentId);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  return (
    <div className={`fixed inset-0 z-40 transition-opacity duration-[250ms] ${open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}>
      <button
        type="button"
        aria-label="Close log drawer"
        onClick={onClose}
        className="absolute inset-0 bg-[rgba(2,6,23,0.45)]"
      />
      <section
        aria-hidden={!open}
        className={`absolute inset-x-0 bottom-0 h-[360px] rounded-t-[28px] border border-b-0 border-[var(--cc-border-subtle)] bg-[color-mix(in_srgb,var(--cc-bg-surface)_96%,black_4%)] px-5 pb-5 pt-4 shadow-[0_-24px_60px_rgba(2,6,23,0.4)] transition-transform duration-[250ms] ease-[var(--ease-out)] ${open ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--cc-text-muted)]">Agent Logs</p>
            <p className="mt-1 text-sm text-[var(--cc-text-secondary)]">
              {agentId} - {status}
            </p>
          </div>
          <button type="button" onClick={onClose} className="cc-icon-button" aria-label="Close log drawer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="h-[285px] overflow-y-auto rounded-[22px] border border-white/8 bg-slate-950/55 p-4">
          <div className="space-y-3 font-mono text-xs">
            {entries.map((entry) => (
              <div key={entry.id} className="grid grid-cols-[76px_56px_1fr] gap-3 border-b border-white/5 pb-3 last:border-b-0">
                <span className="text-[var(--cc-text-muted)]">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                <span className={levelTone(entry.level)}>{entry.level}</span>
                <span className="text-slate-200">{entry.message}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
