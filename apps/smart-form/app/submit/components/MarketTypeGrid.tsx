'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { MarketTypeId } from '@/lib/form-schema';
import { MARKET_TYPE_LABELS } from '@/lib/form-schema';

type DisplayMarketCardId = MarketTypeId | 'teaser';

const MARKET_ABBR: Record<MarketTypeId, string> = {
  'player-prop': 'PROP',
  moneyline: 'ML',
  spread: 'SPR',
  total: 'TOT',
  'team-total': 'T-TOT',
};
const EXTRA_CARD_ABBR: Record<'teaser', string> = {
  teaser: 'TEA',
};
const EXTRA_CARD_LABELS: Record<'teaser', string> = {
  teaser: 'Teasers',
};

interface MarketTypeGridProps {
  availableTypes: MarketTypeId[];
  selected: MarketTypeId | undefined;
  onSelect: (type: MarketTypeId) => void;
}

export function MarketTypeGrid({ availableTypes, selected, onSelect }: MarketTypeGridProps) {
  const [showAll, setShowAll] = useState(false);
  if (availableTypes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">Select a sport first</p>
    );
  }

  const hiddenCount = Math.max(0, availableTypes.length - 5);
  const visibleTypes = showAll ? availableTypes : availableTypes.slice(0, 5);
  const cards: DisplayMarketCardId[] = [...visibleTypes, 'teaser'];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {cards.map((type) => {
          const isPlaceholder = type === 'teaser';
          const isSelected = !isPlaceholder && selected === type;
          const abbr = isPlaceholder ? EXTRA_CARD_ABBR[type] : MARKET_ABBR[type];
          const label = isPlaceholder ? EXTRA_CARD_LABELS[type] : MARKET_TYPE_LABELS[type];

          if (isPlaceholder) {
            return (
              <div
                key={type}
                className={cn(
                  'flex min-h-[72px] flex-col items-center gap-1.5 rounded-lg border border-dashed px-3 py-3 text-center',
                  'border-border bg-card/50 text-muted-foreground',
                )}
              >
                <span className="text-xs font-mono font-bold tracking-wider opacity-60">{abbr}</span>
                <span className="text-xs font-medium leading-tight">{label}</span>
                <span className="text-[10px] uppercase tracking-wider opacity-70">Coming Soon</span>
              </div>
            );
          }

        return (
          <button
            key={type}
            type="button"
            onClick={() => onSelect(type)}
            className={cn(
              'flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-center',
              'transition-colors duration-150 cursor-pointer',
              'min-h-[72px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              isSelected
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground',
            )}
          >
            <span className="text-xs font-mono font-bold tracking-wider text-current opacity-60">{abbr}</span>
            <span className="text-xs font-medium leading-tight">{label}</span>
          </button>
        );
      })}
      </div>
      {(hiddenCount > 0 || availableTypes.length >= 5) ? (
        <button
          type="button"
          className="text-xs font-semibold uppercase tracking-wider text-primary transition-colors hover:text-primary/80"
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? 'Show less' : hiddenCount > 0 ? `More markets (${hiddenCount})` : 'More markets'}
        </button>
      ) : null}
    </div>
  );
}
