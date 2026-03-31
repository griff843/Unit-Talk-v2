/**
 * Determines allowed actions for a pick based on its canonical lifecycle status.
 *
 * This is the single source of truth for action availability in the Command Center.
 * Actions derive from the fetched pick state, never from URL params or client assumptions.
 */

export type PickAction = 'settle' | 'correct' | 'void';

/**
 * Returns the list of allowed mutation actions for a given pick lifecycle status.
 *
 * - validated / queued / posted: can settle or void
 * - settled: can correct (creates a correction record) but not re-settle
 * - voided: no mutation actions
 */
export function getAllowedActions(pickStatus: string): PickAction[] {
  switch (pickStatus) {
    case 'validated':
    case 'queued':
    case 'posted':
      return ['settle', 'void'];
    case 'settled':
      return ['correct'];
    case 'voided':
      return [];
    default:
      // Unknown status — no actions to be safe
      return [];
  }
}
