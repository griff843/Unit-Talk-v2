'use client';

import { cn } from '@/lib/utils';
import type { MarketTypeId } from '@/lib/form-schema';
import { MARKET_TYPE_LABELS } from '@/lib/form-schema';

const MARKET_ABBR: Record<MarketTypeId, string> = {
  'player-prop': 'PROP',
  moneyline: 'ML',
  spread: 'SPR',
  total: 'TOT',
  'team-total': 'T-TOT',
};

interface MarketTypeGridProps {
  availableTypes: MarketTypeId[];
  selected: MarketTypeId | undefined;
  onSelect: (type: MarketTypeId) => void;
}

export function MarketTypeGrid({ availableTypes, selected, onSelect }: MarketTypeGridProps) {
  if (availableTypes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">Select a sport first</p>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {availableTypes.map((type) => {
        const isSelected = selected === type;
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
            <span className="text-xs font-mono font-bold tracking-wider text-current opacity-60">{MARKET_ABBR[type]}</span>
            <span className="text-xs font-medium leading-tight">{MARKET_TYPE_LABELS[type]}</span>
          </button>
        );
      })}
    </div>
  );
}
