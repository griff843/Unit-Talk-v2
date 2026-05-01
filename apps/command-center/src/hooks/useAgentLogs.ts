'use client';

import { useEffect, useMemo, useState } from 'react';

export interface AgentLogEntry {
  id: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  timestamp: string;
}

function seedLogs(agentId: string): AgentLogEntry[] {
  const now = Date.now();
  return [
    {
      id: `${agentId}-1`,
      level: 'info',
      message: 'Runtime connected to control plane.',
      timestamp: new Date(now - 14_000).toISOString(),
    },
    {
      id: `${agentId}-2`,
      level: 'info',
      message: 'Heartbeat acknowledged for shared component lane.',
      timestamp: new Date(now - 8_000).toISOString(),
    },
    {
      id: `${agentId}-3`,
      level: 'warning',
      message: 'Waiting on fresh operator surface payload.',
      timestamp: new Date(now - 2_000).toISOString(),
    },
  ];
}

export function useAgentLogs(agentId: string) {
  const [entries, setEntries] = useState<AgentLogEntry[]>(() => seedLogs(agentId));

  useEffect(() => {
    setEntries(seedLogs(agentId));
  }, [agentId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setEntries((current) => {
        const next: AgentLogEntry = {
          id: `${agentId}-${Date.now()}`,
          level: 'info',
          message: 'Heartbeat OK. UI lane remains responsive.',
          timestamp: new Date().toISOString(),
        };
        return [next, ...current].slice(0, 24);
      });
    }, 4_000);

    return () => window.clearInterval(timer);
  }, [agentId]);

  const status = useMemo(() => {
    if (entries.some((entry) => entry.level === 'error')) return 'error' as const;
    if (entries.some((entry) => entry.level === 'warning')) return 'warning' as const;
    return 'healthy' as const;
  }, [entries]);

  return { entries, status };
}
