export type CommandCenterRouteClassification =
  | 'authoritative'
  | 'degraded'
  | 'deferred'
  | 'stub'
  | 'duplicate'
  | 'retired';

export type CommandCenterPrimaryIcon =
  | 'overview'
  | 'review'
  | 'picks'
  | 'settlement'
  | 'exceptions'
  | 'health';

export interface CommandCenterRoute {
  href: string;
  label: string;
  description: string;
  classification: CommandCenterRouteClassification;
  classificationReason: string;
  primary: boolean;
  primaryParent?: string;
  primaryIcon?: CommandCenterPrimaryIcon;
  workspace?: 'decision' | 'intelligence';
}

/**
 * The sole Command Center route and navigation authority.
 *
 * Every page.tsx route is classified here. Only the six records marked
 * `primary` are allowed into the sidebar and command palette. Secondary and
 * historical routes remain addressable only with an explicit disposition
 * banner supplied by CommandCenterShell.
 */
export const COMMAND_CENTER_ROUTES: readonly CommandCenterRoute[] = [
  primary('/', 'Overview', 'Current operator truth across lifecycle, delivery, settlement, and runtime signals.', 'overview'),
  primary('/review', 'Review', 'Governed picks awaiting an operator decision.', 'review'),
  primary('/picks', 'Active Picks', 'Search and inspect current canonical pick lifecycle state.', 'picks'),
  primary('/settlement', 'Settlement', 'Settle posted picks and inspect immutable settlement history.', 'settlement'),
  primary('/exceptions', 'Exceptions', 'Ranked operational failures, blockers, and intervention cues.', 'exceptions'),
  primary('/api-health', 'System Health', 'Provider, runtime, and ingestion telemetry with explicit freshness.', 'health'),

  route('/picks/[id]', 'Pick Detail', 'Canonical detail and governed actions for one pick.', 'authoritative',
    'Retained as a child of Active Picks.', { primaryParent: '/picks' }),

  route('/pipeline', 'Pipeline', 'Read-only lifecycle flow telemetry.', 'degraded',
    'Retained outside primary navigation; it renders unavailable when pipeline truth cannot be read.'),

  route('/fire-board', 'Fire Board', 'Former exception ranking surface.', 'duplicate',
    'Consolidated into Exceptions.', { primaryParent: '/exceptions' }),
  route('/operations/results', 'Results Ops', 'Former settlement operations surface.', 'duplicate',
    'Consolidated into Settlement.', { primaryParent: '/settlement' }),

  route('/agents', 'Agents', 'Historical agent control route.', 'stub', 'Redirects to System Health.', { primaryParent: '/api-health' }),
  route('/burn-in', 'Burn-in', 'Historical runtime verification route.', 'stub', 'Redirects to System Health.', { primaryParent: '/api-health' }),
  route('/decisions', 'Decisions', 'Historical review route.', 'stub', 'Redirects to Review.', { primaryParent: '/review' }),
  route('/held', 'Held', 'Historical held-pick route.', 'stub', 'Redirects to Review.', { primaryParent: '/review' }),
  route('/interventions', 'Interventions', 'Historical intervention route.', 'stub', 'Redirects to Exceptions.', { primaryParent: '/exceptions' }),
  route('/ops', 'Ops', 'Historical operations route.', 'stub', 'Redirects to System Health.', { primaryParent: '/api-health' }),
  route('/picks-list', 'Picks List', 'Historical picks index.', 'stub', 'Redirects to Active Picks.', { primaryParent: '/picks' }),
  route('/runtime-dashboard', 'Runtime Dashboard', 'Historical runtime route.', 'stub', 'Redirects to System Health.', { primaryParent: '/api-health' }),
  route('/research', 'Research', 'Historical research index.', 'stub', 'Redirects to a deferred research module.'),
  route('/research/hit-rate', 'Hit Rate', 'Historical hit-rate route.', 'stub', 'Redirects to deferred trend research.'),
  route('/research/matchups', 'Matchups', 'Historical matchup route.', 'stub', 'Redirects to deferred team research.'),

  route('/events', 'Events', 'Submission and runtime event replay.', 'deferred',
    'Removed from the primary workflow until event replay is revalidated as operator-grade truth.'),
  route('/model-health', 'Model Health', 'Model runtime health and diagnostics.', 'deferred',
    'Removed from primary navigation because it is not required for the six-workflow operator loop.'),
  route('/performance', 'Performance', 'Performance and attribution reporting.', 'deferred',
    'Decision-support reporting is deferred from the primary operator workflow.', { workspace: 'intelligence' }),
  route('/intelligence', 'Form Windows', 'Model and score-window reporting.', 'deferred',
    'Model economics are deferred until the measurements are fully authoritative.', { workspace: 'intelligence' }),
  route('/intelligence/attribution', 'Governed Attribution', 'Attribution reporting.', 'deferred',
    'Attribution is retained for direct access but removed from primary navigation.', { workspace: 'intelligence' }),
  route('/intelligence/calibration', 'Model Feedback', 'Calibration and feedback reporting.', 'deferred',
    'Calibration is retained for direct access but removed from primary navigation.', { workspace: 'intelligence' }),
  route('/intelligence/roi', 'ROI Overview', 'ROI reporting shell.', 'deferred',
    'This route remains a non-primary shell.', { workspace: 'intelligence' }),

  route('/decision', 'Decision Modules', 'Decision-support module index.', 'deferred',
    'Decision modules are outside the six-workflow primary operator boundary.', { workspace: 'decision' }),
  route('/decision/board-queue', 'Board Queue', 'Governed board candidate review.', 'deferred',
    'Retained for direct access; not part of the primary workflow.', { workspace: 'decision' }),
  route('/decision/board', 'Board Saturation', 'Board-cap monitoring.', 'deferred',
    'Retained for direct access; not part of the primary workflow.', { workspace: 'decision' }),
  route('/decision/hedges', 'Hedge Overlays', 'Hedge guidance shell.', 'deferred',
    'Deferred shell with no primary-navigation claim.', { workspace: 'decision' }),
  route('/decision/preview', 'Promotion Preview', 'Promotion evaluation preview.', 'deferred',
    'Not connected to an authoritative read API.', { workspace: 'decision' }),
  route('/decision/routing', 'Routing Preview', 'Downstream routing preview.', 'deferred',
    'Not connected to an authoritative routing API.', { workspace: 'decision' }),
  route('/decision/scores', 'Score Breakdown', 'Promotion score inspection.', 'deferred',
    'Retained for direct access; not part of the primary workflow.', { workspace: 'decision' }),

  route('/execution/discord-preview', 'Discord Preview', 'Read-only delivery preview.', 'deferred',
    'Execution tooling is removed from primary navigation.'),
  route('/execution/pick-builder', 'Pick Builder', 'Internal pick composition tool.', 'deferred',
    'New-pick tooling is outside this stabilization phase.'),
  route('/execution/results', 'Results Tracking', 'Execution result tracking.', 'deferred',
    'Execution tooling is removed from primary navigation.'),
  route('/execution/scheduled', 'Scheduled Dispatch', 'Scheduled dispatch view.', 'deferred',
    'Scheduling is removed from primary navigation.'),

  route('/operations/approvals', 'Approvals', 'Legacy approval operations view.', 'deferred',
    'The authoritative approval workflow is Review.', { primaryParent: '/review' }),
  route('/operations/discord', 'Discord Control', 'Discord delivery controls.', 'deferred',
    'Delivery control is not a primary workflow in this phase.'),
  route('/operations/governance', 'Governance Lanes', 'Lane and governance telemetry.', 'deferred',
    'Governance telemetry is retained for direct access only.'),
  route('/operations/outbox', 'Dispatch Outbox', 'Distribution outbox inspection.', 'deferred',
    'Outbox inspection is retained for direct access only.'),

  route('/intel/alerts', 'Alert Builder', 'Local alert-definition builder.', 'deferred',
    'New intelligence tooling is outside this stabilization phase.'),
  route('/intel/arbitrage', 'Arbitrage Finder', 'Arbitrage analysis.', 'deferred',
    'Trading-desk expansion is outside this stabilization phase.'),
  route('/intel/boosts', 'Boost Analyzer', 'Boost analysis.', 'deferred',
    'Trading-desk expansion is outside this stabilization phase.'),
  route('/intel/ev-feed', 'EV Feed', 'Expected-value feed.', 'deferred',
    'Trading-desk expansion is outside this stabilization phase.'),
  route('/intel/injuries', 'Injury Monitor', 'Injury monitoring.', 'deferred',
    'Research expansion is outside this stabilization phase.'),
  route('/intel/line-movement', 'Line Movement', 'Line movement analysis.', 'deferred',
    'Trading-desk expansion is outside this stabilization phase.'),
  route('/intel/middles', 'Middle Finder', 'Middle analysis.', 'deferred',
    'Trading-desk expansion is outside this stabilization phase.'),
  route('/intel/sharp-books', 'Sharp Book Compare', 'Sportsbook comparison.', 'deferred',
    'Trading-desk expansion is outside this stabilization phase.'),
  route('/intel/teams', 'Team Research', 'Team research backed by direct privileged reads.', 'deferred',
    'Direct-read authority is a residual deployment risk; this route is not primary.'),

  route('/research/lines', 'Odds Board', 'Market line research.', 'deferred',
    'Research is removed from primary navigation.'),
  route('/research/players', 'Player Research', 'Participant research.', 'deferred',
    'Research is removed from primary navigation.'),
  route('/research/props', 'Props Explorer', 'Prop-market research.', 'deferred',
    'Research is removed from primary navigation.'),
  route('/research/trends', 'Trend Explorer', 'Trend research.', 'deferred',
    'Research is removed from primary navigation.'),
] as const;

function primary(
  href: string,
  label: string,
  description: string,
  primaryIcon: CommandCenterPrimaryIcon,
): CommandCenterRoute {
  return {
    href,
    label,
    description,
    classification: 'authoritative',
    classificationReason: 'One of the six authoritative internal operator workflows.',
    primary: true,
    primaryIcon,
  };
}

function route(
  href: string,
  label: string,
  description: string,
  classification: CommandCenterRouteClassification,
  classificationReason: string,
  options: Pick<CommandCenterRoute, 'primaryParent' | 'workspace'> = {},
): CommandCenterRoute {
  return { href, label, description, classification, classificationReason, primary: false, ...options };
}

export function getPrimaryCommandCenterRoutes(): readonly CommandCenterRoute[] {
  return COMMAND_CENTER_ROUTES.filter((routeEntry) => routeEntry.primary);
}

export function getWorkspaceRoutes(workspace: NonNullable<CommandCenterRoute['workspace']>): readonly CommandCenterRoute[] {
  return COMMAND_CENTER_ROUTES.filter((routeEntry) => routeEntry.workspace === workspace && routeEntry.href !== `/${workspace}`);
}

export function isCommandCenterRouteActive(routeEntry: CommandCenterRoute, pathname: string): boolean {
  if (routeEntry.href.includes('[')) {
    const prefix = routeEntry.href.slice(0, routeEntry.href.indexOf('['));
    return pathname.startsWith(prefix) && pathname.length > prefix.length;
  }
  return pathname === routeEntry.href;
}

export function getRouteMeta(pathname: string): CommandCenterRoute | null {
  return COMMAND_CENTER_ROUTES.find((routeEntry) => isCommandCenterRouteActive(routeEntry, pathname)) ?? null;
}

export function getPrimaryRouteForPath(pathname: string): string | null {
  const routeEntry = getRouteMeta(pathname);
  if (!routeEntry) return null;
  if (routeEntry.primary) return routeEntry.href;
  return routeEntry.primaryParent ?? null;
}
