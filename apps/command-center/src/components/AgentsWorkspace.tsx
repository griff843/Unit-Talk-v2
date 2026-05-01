'use client';

import React from 'react';
import { useState } from 'react';
import { AgentCard, LogDrawer } from '@/components/ui';
import type { AgentStatus } from '@/components/ui';

const AGENTS: AgentStatus[] = [
  {
    id: 'codex-frontend',
    name: 'CodexFrontend',
    role: 'Frontend / Runtime',
    status: 'busy',
    lastHeartbeat: new Date(Date.now() - 2_000).toISOString(),
    currentTask: 'Wiring command-center agent and ops surfaces.',
    cpu: 74,
    memory: 68,
  },
  {
    id: 'verification-lead',
    name: 'VerificationLead',
    role: 'QA / Proof',
    status: 'healthy',
    lastHeartbeat: new Date(Date.now() - 9_000).toISOString(),
    currentTask: 'Standing by for UI verification and proof capture.',
    cpu: 28,
    memory: 44,
  },
  {
    id: 'claude-governance',
    name: 'ClaudeGovernance',
    role: 'Spec / Governance',
    status: 'warning',
    lastHeartbeat: new Date(Date.now() - 41_000).toISOString(),
    currentTask: 'Reviewing execution-policy deltas for command-center rollout.',
    cpu: 52,
    memory: 57,
  },
  {
    id: 'runtime-watch',
    name: 'RuntimeWatch',
    role: 'System Observer',
    status: 'healthy',
    lastHeartbeat: new Date(Date.now() - 16_000).toISOString(),
    currentTask: 'Monitoring worker heartbeats and ops intervention readiness.',
    cpu: 36,
    memory: 39,
  },
];

export function AgentsWorkspace() {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(AGENTS[0]?.id ?? null);

  const selectedAgent = AGENTS.find((agent) => agent.id === selectedAgentId) ?? AGENTS[0] ?? null;

  return (
    <div className="flex flex-col gap-6 pb-[23rem]">
      <section className="cc-surface overflow-hidden p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--cc-text-muted)]">Agents</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-[var(--cc-text-primary)]">
              Live operator lanes with heartbeat-aware runtime detail.
            </h2>
          </div>
          <p className="max-w-md text-sm leading-6 text-[var(--cc-text-secondary)]">
            Select any agent card to inspect the bottom-docked log stream without leaving the grid.
          </p>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        {AGENTS.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            onClick={() => setSelectedAgentId(agent.id)}
            selected={selectedAgent?.id === agent.id}
          />
        ))}
      </section>

      {selectedAgent ? (
        <LogDrawer
          agentId={selectedAgent.id}
          open={selectedAgentId !== null}
          onClose={() => setSelectedAgentId(null)}
        />
      ) : null}
    </div>
  );
}
