export type CommandCenterRouteState = 'authoritative' | 'unavailable' | 'hidden';

export interface CommandCenterRoute {
  href: string;
  label: string;
  shortLabel: string;
  eyebrow: string;
  description: string;
  liveLabel: string;
  state: CommandCenterRouteState;
  nav: boolean;
  match?: string[];
  stateReason?: string;
}

export const COMMAND_CENTER_ROUTES: CommandCenterRoute[] = [
  {
    href: '/',
    label: 'Overview',
    shortLabel: 'Home',
    eyebrow: 'Truth Spine',
    description: 'Live operational readout across queue pressure, runtime health, delivery risk, and settlement posture.',
    liveLabel: 'active alerts',
    state: 'authoritative',
    nav: true,
    match: ['/'],
  },
  {
    href: '/review',
    label: 'Review',
    shortLabel: 'Review',
    eyebrow: 'Operator Loop',
    description: 'Approve, deny, or hold governed picks with governance context and promotion readiness in view.',
    liveLabel: 'awaiting review',
    state: 'authoritative',
    nav: true,
    match: ['/review', '/held', '/decisions', '/decision'],
  },
  {
    href: '/picks',
    label: 'Active Picks',
    shortLabel: 'Picks',
    eyebrow: 'Lifecycle Board',
    description: 'Operational index of active, posted, held, and recently acted-on picks across the lifecycle.',
    liveLabel: 'active picks',
    state: 'authoritative',
    nav: true,
    match: ['/picks', '/picks-list'],
  },
  {
    href: '/settlement',
    label: 'Settlement',
    shortLabel: 'Settle',
    eyebrow: 'Result Control',
    description: 'Awaiting-settlement picks, correction pressure, and the latest outcome truth for operator grading work.',
    liveLabel: 'awaiting grading',
    state: 'authoritative',
    nav: true,
    match: ['/settlement'],
  },
  {
    href: '/exceptions',
    label: 'Exceptions',
    shortLabel: 'Except',
    eyebrow: 'Intervention Rail',
    description: 'Delivery failures, stale lifecycle states, manual review blockers, and retry-worthy interventions.',
    liveLabel: 'open exceptions',
    state: 'authoritative',
    nav: true,
    match: ['/exceptions'],
  },
  {
    href: '/research',
    label: 'Research',
    shortLabel: 'Research',
    eyebrow: 'Decision Support',
    description: 'Live market, matchup, participant, and performance tools that support operator decisions.',
    liveLabel: 'live modules',
    state: 'authoritative',
    nav: true,
    match: [
      '/research',
      '/research/matchups',
      '/research/players',
      '/research/props',
      '/research/lines',
      '/research/hit-rate',
      '/research/trends',
    ],
  },
  {
    href: '/events',
    label: 'Events',
    shortLabel: 'Events',
    eyebrow: 'Deferred Surface',
    description: 'Submission event replay has been removed from the primary command center until it is revalidated for operator use.',
    liveLabel: 'hidden',
    state: 'hidden',
    nav: false,
    match: ['/events'],
    stateReason: 'Removed from primary navigation until the event stream is rebuilt as an authoritative operator surface.',
  },
  {
    href: '/pipeline',
    label: 'Pipeline',
    shortLabel: 'Flow',
    eyebrow: 'Deferred Surface',
    description: 'Pipeline staging has been removed from the primary command center until it can operate as a true lifecycle surface.',
    liveLabel: 'hidden',
    state: 'hidden',
    nav: false,
    match: ['/pipeline'],
    stateReason: 'The old system-flow room implied readiness without matching the lifecycle-first operator workflow.',
  },
  {
    href: '/api-health',
    label: 'API Health',
    shortLabel: 'APIs',
    eyebrow: 'Deferred Surface',
    description: 'Provider health lives outside the primary operator loop until it is reintroduced with tighter actionability.',
    liveLabel: 'hidden',
    state: 'hidden',
    nav: false,
    match: ['/api-health', '/burn-in', '/model-health'],
    stateReason: 'Provider-health drill-downs are not part of the phase-one command center navigation contract.',
  },
  {
    href: '/agents',
    label: 'Agents',
    shortLabel: 'Agents',
    eyebrow: 'Deferred Surface',
    description: 'Agent orchestration has been removed from the operator command center until it reflects authoritative execution truth.',
    liveLabel: 'hidden',
    state: 'hidden',
    nav: false,
    match: ['/agents', '/interventions'],
    stateReason: 'Agent status and orchestration metrics are not trustworthy enough yet for command-center placement.',
  },
  {
    href: '/intelligence',
    label: 'Intelligence',
    shortLabel: 'Intel',
    eyebrow: 'Deferred Surface',
    description: 'Model-economics surfaces remain outside the command center until they directly support operator decisions.',
    liveLabel: 'hidden',
    state: 'hidden',
    nav: false,
    match: ['/intelligence', '/performance'],
    stateReason: 'This room is demoted until it becomes an operator-grade decision support surface instead of a side dashboard.',
  },
  {
    href: '/ops',
    label: 'Ops',
    shortLabel: 'Ops',
    eyebrow: 'Deferred Surface',
    description: 'The old control-room surface has been removed from the primary command center until its controls and audit data are authoritative.',
    liveLabel: 'hidden',
    state: 'hidden',
    nav: false,
    match: ['/ops'],
    stateReason: 'Emergency-control and audit surfaces cannot imply operator readiness until they are backed by real control-plane truth.',
  },
];

export function getPrimaryCommandCenterRoutes() {
  return COMMAND_CENTER_ROUTES.filter((route) => route.nav);
}

export function getRouteMeta(pathname: string) {
  const match = COMMAND_CENTER_ROUTES.find((route) => {
    const patterns = route.match ?? [route.href];
    return patterns.some((pattern) => pathname === pattern || pathname.startsWith(`${pattern}/`));
  });

  return match ?? COMMAND_CENTER_ROUTES[0]!;
}
