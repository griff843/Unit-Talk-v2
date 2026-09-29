import React from 'react';
import { readHumanCapperDeliveryAuthorization } from '@unit-talk/contracts';
import { Card } from '@/components/ui/Card';

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-36 shrink-0 text-gray-400">{label}</span>
      <span className="font-mono break-all text-gray-200">{value ?? '—'}</span>
    </div>
  );
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function distributionModeLabel(value: unknown): string | null {
  if (value === 'track-only') return 'Track Only';
  if (value === 'delivery-eligible') return 'Delivery eligible';
  return null;
}

function readRequestedDistributionMode(metadata: Record<string, unknown>): string | null {
  const recorded = distributionModeLabel(metadata['requestedDistributionMode'])
    ?? distributionModeLabel(metadata['requested_distribution_mode']);
  if (recorded) return recorded;

  return readHumanCapperDeliveryAuthorization(metadata)?.reason === 'track-only-requested'
    ? 'Track Only'
    : null;
}

function participantResolutionSummary(metadata: Record<string, unknown>): React.ReactNode {
  const resolution = readObject(metadata['participantResolution']);
  if (!resolution) return 'No participant resolution recorded.';

  if (resolution['resolution'] === 'canonical') {
    const participants = ['away', 'home', 'team', 'player'].flatMap((role) => {
      const participant = readObject(resolution[role]);
      const name = typeof participant?.['displayName'] === 'string' ? participant['displayName'] : null;
      return name ? [`${role}: ${name}`] : [];
    });
    return participants.length > 0
      ? `Canonical: ${participants.join(' • ')}`
      : 'Canonical participant resolution recorded.';
  }

  if (resolution['resolution'] === 'manual' && resolution['reason'] === 'canonical-coverage-gap') {
    const participants = Array.isArray(resolution['enteredParticipants'])
      ? resolution['enteredParticipants'].flatMap((value) => {
        const participant = readObject(value);
        const role = typeof participant?.['role'] === 'string' ? participant['role'] : null;
        const name = typeof participant?.['displayName'] === 'string' ? participant['displayName'] : null;
        return role && name ? [`${role}: ${name}`] : [];
      })
      : [];
    return participants.length > 0
      ? `Manual — canonical-coverage-gap: ${participants.join(' • ')}`
      : 'Manual — canonical-coverage-gap.';
  }

  return 'No participant resolution recorded.';
}

export type DeliveryKillSwitchTruth =
  | { state: 'killed'; target: string; reason: string | null; actor: string | null; updatedAt: string }
  | { state: 'open'; target: string; reason: string | null; actor: string | null; updatedAt: string }
  | { state: 'missing'; target: string }
  | { state: 'unavailable'; target: string };

export function GovernedPickTruth({ metadata, hasEventLink, voided, deliveryKillSwitch }: {
  metadata: Record<string, unknown>;
  hasEventLink: boolean;
  voided: boolean;
  deliveryKillSwitch?: DeliveryKillSwitchTruth;
}) {
  const authorization = readHumanCapperDeliveryAuthorization(metadata);
  const persistedMode = distributionModeLabel(metadata['distributionMode']);
  const requestedMode = readRequestedDistributionMode(metadata);
  const edgeProvenance = readObject(metadata['edgeProvenance']);
  const edgeScopeReason = typeof edgeProvenance?.['fallbackReason'] === 'string'
    ? edgeProvenance['fallbackReason']
    : typeof metadata['edgeFallbackReason'] === 'string'
      ? metadata['edgeFallbackReason']
      : null;

  return (
    <>
      {voided ? (
        <div role="alert" className="rounded-lg border border-rose-500/50 bg-rose-950/40 px-4 py-3 text-sm text-rose-100">
          <strong>Voided pick.</strong> This pick has been voided and is not active.
        </div>
      ) : null}
      <Card title="Governed submission truth">
        <div className="flex flex-col gap-1">
          <KV label="Persisted mode" value={persistedMode ?? 'Distribution mode not recorded'} />
          {requestedMode ? <KV label="Capper requested" value={requestedMode} /> : null}
          <KV label="Participant resolution" value={participantResolutionSummary(metadata)} />
          <KV label="Edge fallback / scope" value={edgeScopeReason ?? 'No edge fallback or scope reason recorded.'} />
        </div>
        <div className="mt-4 rounded border border-gray-800 bg-gray-950/60 p-3 text-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Delivery authorization</p>
          {authorization ? (
            <div className="mt-2 flex flex-col gap-1">
              <KV label="Decision" value={authorization.decision} />
              {authorization.reason ? <KV label="Reason" value={authorization.reason} /> : null}
              <KV label="Authority" value={authorization.authority} />
              <KV label="Decided at" value={authorization.decidedAt} />
            </div>
          ) : <p className="mt-2 text-gray-300">No delivery authorization recorded.</p>}
        </div>
        {deliveryKillSwitch ? (
          <div className="mt-4 rounded border border-amber-500/40 bg-amber-950/20 p-3 text-sm text-amber-100">
            {deliveryKillSwitch.state === 'killed' ? (
              <>
                <p className="font-medium">Delivery held: <code>{deliveryKillSwitch.target}</code> kill switch engaged</p>
                <div className="mt-2 flex flex-col gap-1">
                  <KV label="Reason" value={deliveryKillSwitch.reason ?? 'No reason recorded'} />
                  <KV label="Actor" value={deliveryKillSwitch.actor ?? 'No actor recorded'} />
                  <KV label="Updated at" value={deliveryKillSwitch.updatedAt} />
                </div>
              </>
            ) : deliveryKillSwitch.state === 'missing' ? (
              <p>Delivery held: the worker fails closed because <code>{deliveryKillSwitch.target}</code> has no kill-switch row.</p>
            ) : deliveryKillSwitch.state === 'unavailable' ? (
              <p>Kill-switch state unavailable</p>
            ) : (
              <>
                <p className="font-medium">Delivery target: <code>{deliveryKillSwitch.target}</code> kill switch disengaged</p>
                <div className="mt-2 flex flex-col gap-1">
                  <KV label="Reason" value={deliveryKillSwitch.reason ?? 'No reason recorded'} />
                  <KV label="Actor" value={deliveryKillSwitch.actor ?? 'No actor recorded'} />
                  <KV label="Updated at" value={deliveryKillSwitch.updatedAt} />
                </div>
              </>
            )}
          </div>
        ) : null}
        {!hasEventLink ? (
          <p className="mt-4 rounded border border-amber-500/40 bg-amber-950/20 p-3 text-sm text-amber-100">
            No event link is recorded. Automated grading skips this pick at <code>event_link_not_found</code>; it settles by operator action.
          </p>
        ) : null}
      </Card>
    </>
  );
}
