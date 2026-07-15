'use client';

import { useState, useTransition } from 'react';
import { InternalLabelBadge } from '@/components/ui';
import { setDeliveryKillSwitch } from './actions';
import type { DeliveryKillSwitchStatus } from '@/lib/data/discord-ops';

const GOVERNED_TARGETS = ['best-bets', 'trader-insights', 'exclusive-insights'] as const;

interface KillSwitchPanelProps {
  statuses: DeliveryKillSwitchStatus[];
}

/**
 * UTV2-1427: live, staff-authorized, auditable delivery kill switch.
 * A missing row for a target means the worker treats it as killed (fail
 * closed) — this panel surfaces that explicitly rather than showing blank.
 */
export function KillSwitchPanel({ statuses }: KillSwitchPanelProps) {
  const byTarget = new Map(statuses.map((s) => [s.target, s]));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(target: string, currentlyKilled: boolean) {
    setError(null);
    const reason = currentlyKilled
      ? window.prompt(`Reason for releasing the kill switch on ${target}?`, '') ?? ''
      : window.prompt(`Reason for engaging the kill switch on ${target}?`, '') ?? '';
    if (reason.trim().length === 0) return;
    startTransition(async () => {
      const result = await setDeliveryKillSwitch(target, !currentlyKilled, reason);
      if (!result.ok) setError(result.error);
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
        Live, DB-backed toggle checked by the worker before every dequeue — no code deploy required.
        A target with no row here is treated as killed (fail closed).
      </p>
      {error ? <p className="mb-2 text-xs text-red-400">{error}</p> : null}
      <div className="flex flex-col gap-2">
        {GOVERNED_TARGETS.map((target) => {
          const status = byTarget.get(target);
          const killed = status?.killed ?? true;
          return (
            <div
              key={target}
              className="flex items-center justify-between gap-3 rounded border border-gray-800/60 px-3 py-2"
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
                <InternalLabelBadge label={killed ? 'Blocked' : 'Healthy'} />
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
