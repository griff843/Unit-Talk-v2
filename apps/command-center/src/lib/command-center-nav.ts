export interface CommandCenterRoute {
  href: string;
  label: string;
  shortLabel: string;
  eyebrow: string;
  description: string;
  liveLabel: string;
}

export const COMMAND_CENTER_ROUTES: CommandCenterRoute[] = [
  {
    href: '/',
    label: 'Overview',
    shortLabel: 'Home',
    eyebrow: 'Command Deck',
    description: 'Live operational readout across the pick lifecycle, runtime health, and escalation pressure.',
    liveLabel: 'active alerts',
  },
  {
    href: '/picks',
    label: 'Picks',
    shortLabel: 'Picks',
    eyebrow: 'Operator Flow',
    description: 'Review queue, held volume, and the picks that need the next human or agent decision.',
    liveLabel: 'queued picks',
  },
  {
    href: '/pipeline',
    label: 'Pipeline',
    shortLabel: 'Flow',
    eyebrow: 'System Flow',
    description: 'Ingestion to grading to promotion status with stage lag, backlog movement, and publish pressure.',
    liveLabel: 'items in flight',
  },
  {
    href: '/events',
    label: 'Events',
    shortLabel: 'Events',
    eyebrow: 'Live Feed',
    description: 'Submission event stream with a replay-ready timeline of the latest operator-relevant signals.',
    liveLabel: 'new events',
  },
  {
    href: '/api-health',
    label: 'API Health',
    shortLabel: 'APIs',
    eyebrow: 'External Health',
    description: 'Provider freshness, quota posture, ingestor heartbeat, and staging integrity across feeds.',
    liveLabel: 'healthy feeds',
  },
  {
    href: '/agents',
    label: 'Agents',
    shortLabel: 'Agents',
    eyebrow: 'Agent Network',
    description: 'Cross-agent execution posture, active assignments, and orchestration bottlenecks.',
    liveLabel: 'agents online',
  },
  {
    href: '/intelligence',
    label: 'Intelligence',
    shortLabel: 'LLM',
    eyebrow: 'Model Economics',
    description: 'LLM usage, decision quality, form windows, and scoring quality for the current operating window.',
    liveLabel: 'requests today',
  },
  {
    href: '/ops',
    label: 'Ops',
    shortLabel: 'Ops',
    eyebrow: 'Control Room',
    description: 'Audit posture, emergency controls, policy drift, and intervention history for operators.',
    liveLabel: 'open controls',
  },
];

export function getRouteMeta(pathname: string) {
  const match = COMMAND_CENTER_ROUTES.find((route) => route.href === pathname);
  return match ?? COMMAND_CENTER_ROUTES[0];
}
