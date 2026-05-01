'use client';

import React, { useEffect, useState } from 'react';

export interface AgentStatus {
  id: string;
  name: string;
  role: string;
  status: 'healthy' | 'busy' | 'warning' | 'down';
  lastHeartbeat: string;
  currentTask: string;
  cpu: number;
  memory: number;
}

export interface AgentCardProps {
  agent: AgentStatus;
  onClick?: () => void;
  selected?: boolean;
}

function relativeTimeLabel(iso: string, nowMs: number) {
  const deltaSeconds = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 1000));
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  const minutes = Math.floor(deltaSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function statusTone(status: AgentStatus['status']) {
  if (status === 'down') return 'bg-rose-400';
  if (status === 'warning') return 'bg-amber-400';
  if (status === 'busy') return 'bg-sky-400';
  return 'bg-emerald-400';
}

export function AgentCard({ agent, onClick, selected = false }: AgentCardProps) {
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const content = (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-lg font-semibold text-[var(--cc-text-primary)]">{agent.name}</p>
          <p className="mt-1 text-sm text-[var(--cc-text-secondary)]">{agent.role}</p>
        </div>
        <span className="relative inline-flex h-3 w-3">
          <span className={`absolute inset-0 rounded-full ${statusTone(agent.status)}`} />
          <span className={`absolute inset-0 rounded-full ${statusTone(agent.status)} animate-ping opacity-75`} />
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--cc-text-muted)]">Current Task</p>
          <p className="mt-1 text-sm text-[var(--cc-text-primary)]">{agent.currentTask}</p>
        </div>
        <div className="flex items-center justify-between text-xs text-[var(--cc-text-secondary)]">
          <span className="capitalize">{agent.status}</span>
          <span>{relativeTimeLabel(agent.lastHeartbeat, nowMs)}</span>
        </div>

        <div className="space-y-2">
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-[var(--cc-text-muted)]">
              <span>CPU</span>
              <span>{agent.cpu}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full bg-sky-400 transition-[width] duration-[250ms]" style={{ width: `${Math.min(100, Math.max(0, agent.cpu))}%` }} />
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-[var(--cc-text-muted)]">
              <span>Memory</span>
              <span>{agent.memory}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full bg-violet-400 transition-[width] duration-[250ms]" style={{ width: `${Math.min(100, Math.max(0, agent.memory))}%` }} />
            </div>
          </div>
        </div>
      </div>
      {onClick ? (
        <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3 text-xs text-[var(--cc-text-secondary)]">
          <span>Open live log stream</span>
          <span className="text-[var(--cc-accent)]">{selected ? 'Active' : 'View'}</span>
        </div>
      ) : null}
    </>
  );

  if (!onClick) {
    return <article className="cc-surface p-5">{content}</article>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`cc-surface w-full p-5 text-left transition-colors hover:bg-[var(--cc-bg-surface-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--cc-accent)] focus:ring-offset-2 focus:ring-offset-[var(--cc-bg-canvas)] ${selected ? 'border-[var(--cc-accent)]' : ''}`}
      aria-pressed={selected}
    >
      {content}
    </button>
  );
}
