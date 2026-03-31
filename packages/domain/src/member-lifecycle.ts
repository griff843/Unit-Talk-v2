/**
 * Member Lifecycle State Machine
 *
 * Formalizes the valid transitions between member tiers:
 *   free → trial → vip → vip-plus → capper
 *   operator (special — can be assigned from any tier)
 *
 * Also handles:
 *   - Trial expiry (trial → free)
 *   - Downgrades (vip → free, vip-plus → vip)
 *   - Role removal
 *
 * Pure computation — no DB, no I/O.
 */

import type { MemberTier } from '@unit-talk/contracts';

export interface TierTransition {
  from: MemberTier;
  to: MemberTier;
  reason: TierTransitionReason;
}

export type TierTransitionReason =
  | 'upgrade'
  | 'downgrade'
  | 'trial_start'
  | 'trial_expired'
  | 'trial_converted'
  | 'role_granted'
  | 'role_removed'
  | 'manual_override';

export interface TransitionResult {
  allowed: boolean;
  transition: TierTransition | null;
  reason: TierTransitionReason | null;
  rejection?: string;
}

/** Tier ordering for upgrade/downgrade detection (lower index = lower tier) */
const TIER_ORDER: readonly MemberTier[] = ['free', 'trial', 'vip', 'vip-plus', 'capper', 'operator'];

function tierIndex(tier: MemberTier): number {
  const idx = TIER_ORDER.indexOf(tier);
  return idx >= 0 ? idx : -1;
}

/**
 * Valid transition rules. Maps `from` tier to allowed `to` tiers with reason.
 */
const ALLOWED_TRANSITIONS: ReadonlyMap<MemberTier, ReadonlyMap<MemberTier, TierTransitionReason>> = new Map([
  ['free', new Map<MemberTier, TierTransitionReason>([
    ['trial', 'trial_start'],
    ['vip', 'role_granted'],
    ['operator', 'role_granted'],
  ])],
  ['trial', new Map<MemberTier, TierTransitionReason>([
    ['free', 'trial_expired'],
    ['vip', 'trial_converted'],
    ['vip-plus', 'trial_converted'],
    ['operator', 'role_granted'],
  ])],
  ['vip', new Map<MemberTier, TierTransitionReason>([
    ['free', 'downgrade'],
    ['vip-plus', 'upgrade'],
    ['capper', 'upgrade'],
    ['operator', 'role_granted'],
  ])],
  ['vip-plus', new Map<MemberTier, TierTransitionReason>([
    ['free', 'downgrade'],
    ['vip', 'downgrade'],
    ['capper', 'upgrade'],
    ['operator', 'role_granted'],
  ])],
  ['capper', new Map<MemberTier, TierTransitionReason>([
    ['free', 'role_removed'],
    ['vip', 'downgrade'],
    ['vip-plus', 'downgrade'],
    ['operator', 'role_granted'],
  ])],
  ['operator', new Map<MemberTier, TierTransitionReason>([
    ['free', 'role_removed'],
    ['vip', 'downgrade'],
    ['capper', 'downgrade'],
  ])],
]);

/**
 * Evaluate whether a tier transition is allowed and determine the reason.
 */
export function evaluateTierTransition(from: MemberTier, to: MemberTier): TransitionResult {
  if (from === to) {
    return { allowed: false, transition: null, reason: null, rejection: 'Same tier — no transition needed' };
  }

  const allowedTargets = ALLOWED_TRANSITIONS.get(from);
  if (!allowedTargets) {
    return { allowed: false, transition: null, reason: null, rejection: `Unknown source tier: ${from}` };
  }

  const reason = allowedTargets.get(to);
  if (!reason) {
    return {
      allowed: false,
      transition: null,
      reason: null,
      rejection: `Transition from '${from}' to '${to}' is not allowed. Valid targets: ${Array.from(allowedTargets.keys()).join(', ')}`,
    };
  }

  return {
    allowed: true,
    transition: { from, to, reason },
    reason,
  };
}

/**
 * Determine if a transition is an upgrade, downgrade, or lateral move.
 */
export function classifyTransition(from: MemberTier, to: MemberTier): 'upgrade' | 'downgrade' | 'lateral' {
  const fromIdx = tierIndex(from);
  const toIdx = tierIndex(to);
  if (toIdx > fromIdx) return 'upgrade';
  if (toIdx < fromIdx) return 'downgrade';
  return 'lateral';
}

/**
 * Get all valid transitions from a given tier.
 */
export function getValidTransitions(from: MemberTier): Array<{ to: MemberTier; reason: TierTransitionReason }> {
  const targets = ALLOWED_TRANSITIONS.get(from);
  if (!targets) return [];
  return Array.from(targets.entries()).map(([to, reason]) => ({ to, reason }));
}

/**
 * Check if a member with the given tier has access to a specific surface.
 * Based on MEMBER_ROLE_ACCESS_AUTHORITY.md:
 *   - free: recaps only
 *   - trial: full VIP surface set (incl. Trader Insights)
 *   - vip: best-bets, recaps
 *   - vip-plus: best-bets, trader-insights, recaps
 *   - capper: all surfaces + submission
 *   - operator: all surfaces + operator tools
 */
export type AccessSurface = 'recaps' | 'best-bets' | 'trader-insights' | 'exclusive-insights' | 'submission' | 'operator-tools';

const TIER_ACCESS: ReadonlyMap<MemberTier, ReadonlySet<AccessSurface>> = new Map([
  ['free', new Set<AccessSurface>(['recaps'])],
  ['trial', new Set<AccessSurface>(['recaps', 'best-bets', 'trader-insights'])],
  ['vip', new Set<AccessSurface>(['recaps', 'best-bets'])],
  ['vip-plus', new Set<AccessSurface>(['recaps', 'best-bets', 'trader-insights'])],
  ['capper', new Set<AccessSurface>(['recaps', 'best-bets', 'trader-insights', 'exclusive-insights', 'submission'])],
  ['operator', new Set<AccessSurface>(['recaps', 'best-bets', 'trader-insights', 'exclusive-insights', 'submission', 'operator-tools'])],
]);

export function hasAccess(tier: MemberTier, surface: AccessSurface): boolean {
  return TIER_ACCESS.get(tier)?.has(surface) ?? false;
}
