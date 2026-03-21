/**
 * Book profile lookup for known sportsbooks.
 * Ported from unit-talk-production marketAdapters/types.ts.
 */

import type { BookProfile, LiquidityTier } from '../probability/devig.js';

export const BOOK_PROFILES: Record<
  string,
  { profile: BookProfile; liquidity: LiquidityTier }
> = {
  pinnacle: { profile: 'sharp', liquidity: 'high' },
  circa: { profile: 'sharp', liquidity: 'medium' },
  draftkings: { profile: 'market_maker', liquidity: 'high' },
  fanduel: { profile: 'market_maker', liquidity: 'high' },
  betmgm: { profile: 'retail', liquidity: 'medium' },
  caesars: { profile: 'retail', liquidity: 'medium' },
  pointsbet: { profile: 'retail', liquidity: 'low' },
  bovada: { profile: 'retail', liquidity: 'medium' },
  bet365: { profile: 'market_maker', liquidity: 'high' },
  williamhill: { profile: 'market_maker', liquidity: 'medium' },
  sgo: { profile: 'retail', liquidity: 'medium' },
};

/** Get book profile for a provider key, with retail fallback */
export function getBookProfile(providerKey: string): {
  profile: BookProfile;
  liquidity: LiquidityTier;
} {
  return (
    BOOK_PROFILES[providerKey.toLowerCase()] ?? {
      profile: 'retail',
      liquidity: 'medium',
    }
  );
}
