'use client';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { SubmitPickResult } from '@/lib/api-client';
import type { BetFormValues } from '@/lib/form-schema';
import { resolveDeliveryDisposition } from '@/lib/delivery-disposition';
import { buildSelectionString, MANUAL_PLAYER_PROVENANCE } from '@/lib/form-utils';
import { getMarketTypeLabel } from '@/lib/market-types';

interface SuccessReceiptProps {
  result: SubmitPickResult;
  submittedValues: BetFormValues;
  onSubmitAnother: () => void;
  /**
   * WORK-2026110802: the player provenance this submission was sent with. A
   * manual player is shown as manually entered, never as canonical or verified.
   */
  playerProvenance?: typeof MANUAL_PLAYER_PROVENANCE | null;
  /**
   * How many suggested catalog players the operator confirmed this player is none of (the 409
   * confirmation step); 0 when none were suggested. Only a count: the receipt never names a
   * catalog player beside an unverified one.
   */
  rejectedCandidateCount?: number;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm gap-4">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-foreground font-medium text-right break-all">{value}</span>
    </div>
  );
}

export function SuccessReceipt({
  result,
  submittedValues,
  onSubmitAnother,
  playerProvenance = null,
  rejectedCandidateCount = 0,
}: SuccessReceiptProps) {
  const v = submittedValues;
  // UTV2-1925: read from `result` -- what the SERVER determined -- never from
  // `v.trackOnly`, which is a client form value that defaults to true and knows
  // nothing about what happened. The old line stated "no member delivery" to a
  // capper whose submission was entering the approval-for-delivery path.
  const disposition = resolveDeliveryDisposition(result);
  const selection = buildSelectionString(v);
  const marketLabel = getMarketTypeLabel(v.marketType);
  const oddsDisplay = v.odds > 0 ? `+${v.odds}` : String(v.odds);
  const unitsDisplay = `${v.units}u`;

  return (
    <div className="bet-slip-panel rounded-2xl p-6 sm:p-8 max-w-md w-full mx-auto space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500 shrink-0" />
          <h2 className="text-lg font-semibold text-foreground">{disposition.headline}</h2>
        </div>
        <p className="text-sm text-muted-foreground pl-4" data-testid="delivery-disposition" data-disposition={disposition.kind}>{disposition.detail}</p>
      </div>

      <Separator className="bg-border/50" />

      <div className="space-y-2.5">
        {v.capper && <Row label="Capper" value={v.capper} />}
        <Row label="Sport" value={v.sport.toUpperCase()} />
        <Row label="Market" value={marketLabel} />
        {selection && <Row label="Selection" value={selection} />}
        {playerProvenance === MANUAL_PLAYER_PROVENANCE && v.playerName && (
          <div data-testid="receipt-manual-player" data-player-provenance={playerProvenance} className="space-y-1">
            <Row label="Player" value={`${v.playerName} (manually entered, unverified)`} />
            <p className="text-xs text-muted-foreground text-right">
              Unverified player: not in reference player data, no provider verification, no CLV.
            </p>
            {rejectedCandidateCount > 0 && (
              <p className="text-xs text-muted-foreground text-right" data-testid="receipt-manual-player-confirmed">
                You confirmed this is none of the {rejectedCandidateCount} suggested catalog player
                {rejectedCandidateCount === 1 ? '' : 's'}.
              </p>
            )}
          </div>
        )}
        {v.eventName && <Row label="Matchup" value={v.eventName} />}
        {v.sportsbook && <Row label="Sportsbook" value={v.sportsbook} />}
        <Row label="Odds" value={oddsDisplay} />
        <Row label="Units" value={unitsDisplay} />
        <Row label="Conviction" value={`${v.capperConviction}/10`} />
        <Row label="Date" value={v.gameDate} />
      </div>

      <Separator className="bg-border/50" />

      <div className="space-y-2.5">
        <Row label="Pick ID" value={result.pickId} />
        <Row label="Status" value={result.lifecycleState} />
      </div>

      <Separator className="bg-border/50" />

      <Button
        onClick={onSubmitAnother}
        variant="outline"
        className="w-full border-border hover:bg-card"
      >
        Submit Another Pick
      </Button>
    </div>
  );
}
