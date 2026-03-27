'use client';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { SubmitPickResult } from '@/lib/api-client';
import type { BetFormValues } from '@/lib/form-schema';
import { MARKET_TYPE_LABELS } from '@/lib/form-schema';
import { buildSelectionString } from '@/lib/form-utils';

interface SuccessReceiptProps {
  result: SubmitPickResult;
  submittedValues: BetFormValues;
  onSubmitAnother: () => void;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm gap-4">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-foreground font-medium text-right">{value}</span>
    </div>
  );
}

export function SuccessReceipt({ result, submittedValues, onSubmitAnother }: SuccessReceiptProps) {
  const v = submittedValues;
  const selection = buildSelectionString(v);
  const marketLabel = MARKET_TYPE_LABELS[v.marketType];
  const oddsDisplay = v.odds > 0 ? `+${v.odds}` : String(v.odds);
  const unitsDisplay = `${v.units}u`;

  return (
    <div className="rounded-xl border border-border bg-gradient-to-br from-slate-900 to-slate-800 p-8 max-w-sm w-full mx-auto space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500 shrink-0" />
          <h2 className="text-lg font-semibold text-foreground">Pick Submitted</h2>
        </div>
        <p className="text-sm text-muted-foreground pl-4">Your pick is in the queue.</p>
      </div>

      <Separator className="bg-border/50" />

      <div className="space-y-2.5">
        <Row label="Capper" value={v.capper} />
        <Row label="Sport" value={v.sport.toUpperCase()} />
        <Row label="Market" value={marketLabel} />
        {selection && <Row label="Selection" value={selection} />}
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
