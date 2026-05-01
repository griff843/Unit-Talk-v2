'use client';

import { useEffect, useState } from 'react';

export interface SecurityEvent {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  actor: string;
  timestamp: string;
}

function seedSecurityEvents(): SecurityEvent[] {
  const now = Date.now();

  return [
    {
      id: 'sec-1',
      severity: 'critical',
      title: 'Admin token used outside normal window',
      detail: 'Emergency credential invoked from operator-web preview lane.',
      actor: 'runtime-guard',
      timestamp: new Date(now - 8 * 60_000).toISOString(),
    },
    {
      id: 'sec-2',
      severity: 'high',
      title: 'Repeated failed approval confirmations',
      detail: 'Three destructive-action confirmation attempts were rejected.',
      actor: 'command-center',
      timestamp: new Date(now - 17 * 60_000).toISOString(),
    },
    {
      id: 'sec-3',
      severity: 'medium',
      title: 'Elevated API retry volume',
      detail: 'Ops endpoints crossed the warning threshold for the last 10 minutes.',
      actor: 'api-gateway',
      timestamp: new Date(now - 31 * 60_000).toISOString(),
    },
    {
      id: 'sec-4',
      severity: 'low',
      title: 'Routine key rotation reminder',
      detail: 'Discord webhook credential rotation is due within 48 hours.',
      actor: 'security-monitor',
      timestamp: new Date(now - 54 * 60_000).toISOString(),
    },
  ];
}

const ROTATING_EVENTS: Array<Omit<SecurityEvent, 'id' | 'timestamp'>> = [
  {
    severity: 'low',
    title: 'Background audit completed',
    detail: 'Command-center access log scan finished without new escalations.',
    actor: 'security-monitor',
  },
  {
    severity: 'medium',
    title: 'Rate-limit shield engaged',
    detail: 'Burst traffic protection throttled a non-critical client.',
    actor: 'edge-firewall',
  },
  {
    severity: 'high',
    title: 'Privilege mismatch detected',
    detail: 'An operator session attempted to open an admin-only control.',
    actor: 'rbac-enforcer',
  },
];

export function useSecurityMonitoring() {
  const [events, setEvents] = useState<SecurityEvent[]>(() => seedSecurityEvents());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setEvents((current) => {
        const template = ROTATING_EVENTS[current.length % ROTATING_EVENTS.length]!;
        const nextEvent: SecurityEvent = {
          ...template,
          id: `sec-${Date.now()}`,
          timestamp: new Date().toISOString(),
        };

        return [nextEvent, ...current].slice(0, 10);
      });
    }, 12_000);

    return () => window.clearInterval(timer);
  }, []);

  return { events };
}
