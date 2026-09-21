'use client';

import { useState, useTransition } from 'react';
import { InternalLabelBadge } from '@/components/ui';
import { setDeliveryKillSwitch } from './actions';
import type { DeliveryKillSwitchStatus } from '@/lib/data/discord-ops';



interface KillSwitchPanelProps {
  statuses: DeliveryKillSwitchStatus[];
  targets: readonly string[];
}

/**
 * UTV2-1427: live, staff-authorized, auditable delivery kill switch.
 * A missing row for a target means the worker treats it as killed (fail
 * closed) — this panel surfaces that explicitly rather than showing blank.
 */
export function KillSwitchPanel({ statuses, targets }: KillSwitchPanelProps) {
  const byTarget = new Map(statuses.map((s) => [s.target, s]));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(target: string, currentlyKilled: boolean) {
    setError(null);
    const reason = currentlyKilled
      ? window.prompt(`Reason for releasing the kill switch on ${target}?`, '') ?? ''
      : window.prompt(`Reason for engaging the kill switch on ${target}?`, '') ?? '';
    if (reason.trim().length === 0) return;
    if (currentlyKilled && !window.confirm(`Release delivery to ${target}? This can allow member-facing posts. Continue only with the owner’s authorization.`)) return;
    startTransition(async () => {
      try {
        const result = await setDeliveryKillSwitch(target, !currentlyKilled, reason);
        if (!result.ok) setError(result.error);
      } catch {
        setError('The delivery control could not be updated. Refresh to check its recorded state before retrying.');
      }
    });
  }

  return (
    <div className="cc-surface p-5">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide cc-text-secondary">
          Delivery Kill Switch
        </h2>
        <InternalLabelBadge label="Internal Only" />
      </div>
      <p className="mb-3 text-xs cc-text-muted">
        Delivery posture recorded for each governed destination. Missing records block delivery.
        Releasing a switch can enable member-facing posts and requires the owner’s authorization.
      </p>
      {error ? <p className="mb-2 text-xs text-red-400">{error}</p> : null}
      <div className="flex flex-col gap-2">
        {targets.map((target) => {
          const status = byTarget.get(target);
          const killed = status?.killed ?? true;
          return (
            <div
              key={target}
              className="flex flex-wrap items-center justify-between gap-3 rounded border border-gray-800/60 px-3 py-2"
            >
              <div>
                <span className="font-mono text-sm">{target}</span>
                {status ? (
                  <span className="ml-2 text-xs cc-text-muted">
                    last changed by {status.actor ?? 'unknown'} at {status.updatedAt}
                    {status.reason ? ` — ${status.reason}` : ''}
                  </span>
                ) : (
                  <span className="ml-2 text-xs cc-text-muted">no record — defaulting to killed</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold">{killed ? 'Delivery blocked' : 'Delivery permitted'}</span>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => toggle(target, killed)}
                  className="rounded border border-gray-700 px-3 py-1 text-xs font-medium hover:bg-gray-800 disabled:opacity-50"
                >
                  {killed ? 'Release' : 'Engage kill switch'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
