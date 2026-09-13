'use client';

import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { betFormSchema, type BetFormValues } from '@/lib/form-schema';
import { calcPayout, buildSelectionString } from '@/lib/form-utils';
import { getMarketTypeLabel, type MarketTypeId } from '@/lib/market-types';

interface BetSlipPanelProps {
  values: Partial<BetFormValues>;
  isSubmitting: boolean;
  onSubmit: () => void;
}

function LineItem({ label, value }: { label: string; value?: string | number | null }) {
  if (value == null || value === '') return null;
  return (
    <div className="flex items-start justify-between gap-2 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-foreground text-right font-medium break-words min-w-0">{value}</span>
    </div>
  );
}

export function BetSlipPanel({ values, isSubmitting, onSubmit }: BetSlipPanelProps) {
  const marketLabel = values.marketType ? getMarketTypeLabel(values.marketType as MarketTypeId) : null;
  const selection = values.marketType && values.sport
    ? buildSelectionString(values as BetFormValues)
    : null;
  const payout = values.units && values.odds
    ? calcPayout(values.units, values.odds)
    : null;

  const hasMinimum = !!(values.sport && values.marketType);
  const validation = betFormSchema.safeParse(values);
  const labels: Record<string, string> = {
    sport: 'Sport', marketType: 'Market', eventName: 'Matchup or event',
    odds: 'Odds', units: 'Units', capperConviction: 'Conviction',
    team: 'Team', playerName: 'Player', statType: 'Stat', line: 'Line',
    direction: 'Over or under', gameDate: 'Date', capper: 'Capper',
  };
  const remaining = validation.success ? [] : [...new Set(validation.error.issues.map(
    issue => labels[String(issue.path[0])] ?? 'Selection',
  ))];

  return (
    <>
      {/* Desktop sticky panel */}
      <div className="flex flex-col lg:sticky lg:top-6 h-fit">
        <div className="bet-slip-panel rounded-2xl p-5 space-y-4">
          {/* Header */}
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-1">
              Your bet slip
            </p>
            {values.capper && (
              <p className="text-sm font-semibold text-foreground">{values.capper}</p>
            )}
          </div>

          {hasMinimum && <Separator className="bg-border/50" />}

          {/* Live summary */}
          {hasMinimum && (
            <div className="space-y-2.5">
              <LineItem label="Sport" value={values.sport} />
              <LineItem label="Market" value={marketLabel} />
              {values.eventName && <LineItem label="Game" value={values.eventName} />}
              {selection && <LineItem label="Pick" value={selection} />}
              {values.sportsbook && <LineItem label="Book" value={values.sportsbook} />}
              {values.odds && <LineItem label="Odds" value={Number(values.odds) > 0 ? `+${Number(values.odds)}` : Number(values.odds)} />}
              {values.units && <LineItem label="Units" value={`${values.units}u`} />}
              {hasMinimum && (
                <LineItem label="Conviction" value={values.capperConviction ? `${values.capperConviction}/10` : 'Not selected'} />
              )}
            </div>
          )}

          {payout !== null && (
            <>
              <Separator className="bg-border/50" />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Est. Profit</span>
                <span className="text-sm font-bold text-primary">
                  +{payout.toFixed(2)}u
                </span>
              </div>
            </>
          )}

          {remaining.length > 0 && (
            <div className="rounded-xl border border-dashed border-border p-4" data-testid="incomplete-slip">
              <p className="text-sm font-semibold text-foreground">{hasMinimum ? 'Still to complete' : 'Start your pick'}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {values.sport ? `Add or check: ${remaining.join(', ')}.` : 'Choose a sport to see its markets.'}
              </p>
            </div>
          )}

          <p className="track-only-pill rounded-lg px-3 py-2.5 text-xs leading-relaxed">{values.trackOnly ? 'Track Only — records stay internal. No member delivery.' : 'Delivery eligible — subject to approval and routing checks.'}</p>

          <Button
            data-testid="smart-form-submit-button"
            type="submit"
            onClick={onSubmit}
            disabled={isSubmitting || !values.sport}
            className="hidden lg:flex w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-5"
          >
            {isSubmitting ? (
              <>
                <Spinner className="mr-2 h-4 w-4" />
                Submitting...
              </>
            ) : (
              'Submit Pick'
            )}
          </Button>
        </div>
      </div>

      {/* Mobile sticky bottom bar */}
      <div
        className={cn(
          'lg:hidden fixed bottom-0 left-0 right-0 z-50',
          'mobile-slip-bar border-t border-border bg-card/95 backdrop-blur-sm px-4 py-3',
        )}
      >
        <div className="flex items-center justify-between gap-4 max-w-lg mx-auto">
          <div className="min-w-0">
            <p className="mb-1 text-[10px] uppercase tracking-widest text-primary">{values.trackOnly ? 'Track Only' : 'Delivery eligible'}</p>
            {hasMinimum ? (
              <>
                <p className="text-xs font-medium text-foreground truncate">
                  {values.sport} · {marketLabel}
                </p>
                {selection && (
                  <p className="text-xs text-muted-foreground truncate">{selection}</p>
                )}
                {hasMinimum && (
                  <p className="text-xs text-muted-foreground truncate">
                    Conviction {values.capperConviction ? `${values.capperConviction}/10` : 'not selected'}
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">{values.sport ? 'Choose your market' : 'Choose a sport to start'}</p>
            )}
          </div>
          {payout !== null && (
            <p className="text-xs font-bold text-primary shrink-0">+{payout.toFixed(2)}u</p>
          )}
          <Button
            data-testid="smart-form-submit-button"
            type="submit"
            onClick={onSubmit}
            disabled={isSubmitting || !values.sport}
            size="sm"
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shrink-0"
          >
            {isSubmitting ? <Spinner className="h-4 w-4" /> : 'Submit'}
          </Button>
        </div>
      </div>
    </>
  );
}
