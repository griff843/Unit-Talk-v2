import { humanCapperRecapControl, humanDeliveryTargets } from '@unit-talk/contracts';
import type { RepositoryBundle } from '@unit-talk/db';

/**
 * WORK-2026092901: whether recap traffic about human-capper picks is stopped.
 *
 * Recaps -- the per-pick settlement recap and the daily/weekly/monthly
 * aggregate -- are posted by direct Discord `fetch`, not through the outbox,
 * so the worker's kill-switch check never sees them. Before this gate the only
 * control over them was the `official-picks` switch itself, so releasing that
 * switch for one watched pick would also have released every recap about
 * every previously settled human-capper pick.
 *
 * Recaps are therefore stopped unless BOTH controls are released:
 *   - `official-picks`: no member delivery, no recap about it;
 *   - `human-capper-recaps`: its own, separate release.
 *
 * Fail closed throughout: a bundle without a kill-switch repository, or a
 * control with no row, is stopped (`isKilled` treats an unknown key as
 * killed). The first controlled release un-kills `official-picks` only; this
 * control stays killed until Griff separately decides recaps.
 */
export async function isHumanCapperRecapStopped(
  repositories: Partial<Pick<RepositoryBundle, 'killSwitch'>>,
): Promise<boolean> {
  const killSwitch = repositories.killSwitch;
  if (!killSwitch) {
    return true;
  }

  const [deliveryKilled, recapsKilled] = await Promise.all([
    killSwitch.isKilled(humanDeliveryTargets[0]),
    killSwitch.isKilled(humanCapperRecapControl),
  ]);
  return deliveryKilled || recapsKilled;
}
