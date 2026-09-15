'use client';

import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { betFormSchema, type BetFormValues } from '@/lib/form-schema';
import { calcPayout, buildSelectionString } from '@/lib/form-utils';
import { getMarketTypeLabel, type MarketTypeId } from '@/lib/market-types';
import type { LegSummary } from '@/lib/bet-slip';

interface BetSlipPanelProps {
  submissionBlocked?: boolean;
  values: Partial<BetFormValues>;
  isSubmitting: boolean;
  onSubmit: () => void;
  /**
   * Legs already committed to the slip, in slip order. Empty means this is the
   * single-pick path and every behaviour below is inert — a slip with no legs
   * renders and submits exactly as it did before UTV2-1915.
   */
  legs?: readonly LegSummary[];
  onRemoveLeg?: (id: string) => void;
  onMoveLeg?: (id: string, direction: 'up' | 'down') => void;
  /** Why the last "add leg" attempt was refused, if it was. */
  slipRefusal?: string | null;
  /** Why a multi-leg slip cannot be submitted today. Null when it can. */
  multiLegRefusal?: string | null;
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

function formatOdds(odds: number) {
  return odds > 0 ? `+${odds}` : String(odds);
}

/**
 * The committed legs. Deliberately shows each leg's own price and nothing
 * combined: a parlay's combined price is defined once, in @unit-talk/contracts
 * (priceParlay, UTV2-1906). A second copy here is how a displayed price and a
 * persisted price drift apart.
 */
function SlipLegList({
  legs,
  onRemoveLeg,
  onMoveLeg,
}: {
  legs: readonly LegSummary[];
  onRemoveLeg?: (id: string) => void;
  onMoveLeg?: (id: string, direction: 'up' | 'down') => void;
}) {
  return (
    <div className="space-y-2" data-testid="slip-legs">
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {legs.length === 1 ? '1 leg' : `${legs.length} legs`}
      </p>
      <ol className="space-y-2">
        {legs.map((leg, index) => (
          <li
            key={leg.id}
            data-testid="slip-leg"
            className="rounded-xl border border-border/70 p-3 text-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-foreground break-words">{leg.selection}</p>
                <p className="text-xs text-muted-foreground break-words">
                  {leg.sport} · {leg.marketLabel} · {leg.eventName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatOdds(leg.odds)} · {leg.units}u{leg.sportsbook ? ` · ${leg.sportsbook}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Move leg ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => onMoveLeg?.(leg.id, 'up')}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Move leg ${index + 1} down`}
                  disabled={index === legs.length - 1}
                  onClick={() => onMoveLeg?.(leg.id, 'down')}
                >
                  ↓
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove leg ${index + 1}`}
                  onClick={() => onRemoveLeg?.(leg.id)}
                >
                  ✕
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function BetSlipPanel({
  values,
  isSubmitting,
  onSubmit,
  submissionBlocked = false,
  legs = [],
  onRemoveLeg,
  onMoveLeg,
  slipRefusal = null,
  multiLegRefusal = null,
}: BetSlipPanelProps) {
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

          {legs.length > 0 && (
            <>
              <SlipLegList legs={legs} onRemoveLeg={onRemoveLeg} onMoveLeg={onMoveLeg} />
              <Separator className="bg-border/50" />
            </>
          )}

          {slipRefusal && (
            <p
              className="rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs leading-relaxed text-foreground"
              data-testid="slip-refusal"
              role="alert"
            >
              {slipRefusal}
            </p>
          )}

          {multiLegRefusal && (
            <p
              className="rounded-xl border border-dashed border-border px-3 py-2 text-xs leading-relaxed text-muted-foreground"
              data-testid="multi-leg-refusal"
            >
              {multiLegRefusal}
            </p>
          )}

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
            disabled={isSubmitting || !values.sport || submissionBlocked}
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
            {legs.length > 0 && (
              <p className="text-xs font-medium text-foreground truncate">
                {legs.length === 1 ? '1 leg on slip' : `${legs.length} legs on slip`}
              </p>
            )}
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
            disabled={isSubmitting || !values.sport || submissionBlocked}
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
