/**
 * UTV2-320: NBA alias gap report
 *
 * Queries live Supabase to:
 * 1. Find unmapped NBA provider market keys present on the live board
 * 2. Suggest likely canonical stat families / priorities from those raw keys
 * 3. Produce a concrete backlog candidate list for alias completion
 *
 * Run: pnpm exec tsx scripts/utv2-320-nba-alias-gap-report.ts
 */

import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

type OfferRow = {
  provider_key: string;
  provider_market_key: string;
};

type AliasRow = {
  provider: string;
  provider_market_key: string;
};

interface GapSuggestion {
  canonicalTarget: string;
  priority: 'high' | 'medium' | 'low';
  rationale: string;
}

function suggestCanonicalTarget(providerMarketKey: string): GapSuggestion {
  const key = providerMarketKey.toLowerCase();

  if (key.includes('threepointersmade')) {
    return {
      canonicalTarget: 'Player Threes',
      priority: 'high',
      rationale: 'Core NBA prop family already expected in Smart Form and missing in alias coverage.',
    };
  }

  if (key.includes('turnovers')) {
    return {
      canonicalTarget: 'Player Turnovers',
      priority: 'high',
      rationale: 'Core NBA prop family already expected in Smart Form and partially present in picks.',
    };
  }

  if (key.includes('points+rebounds+assists')) {
    return {
      canonicalTarget: 'Player Points + Rebounds + Assists',
      priority: 'high',
      rationale: 'High-value combo family for NBA player props and likely first baseline candidate.',
    };
  }

  if (key.includes('points+rebounds')) {
    return {
      canonicalTarget: 'Player Points + Rebounds',
      priority: 'high',
      rationale: 'Core combo family listed in the governed NBA stat set.',
    };
  }

  if (key.includes('points+assists')) {
    return {
      canonicalTarget: 'Player Points + Assists',
      priority: 'high',
      rationale: 'Core combo family listed in the governed NBA stat set.',
    };
  }

  if (key.includes('rebounds+assists')) {
    return {
      canonicalTarget: 'Player Rebounds + Assists',
      priority: 'high',
      rationale: 'Core combo family listed in the governed NBA stat set.',
    };
  }

  if (key.includes('blocks+steals')) {
    return {
      canonicalTarget: 'Player Blocks + Steals',
      priority: 'medium',
      rationale: 'Useful combo family, but not part of the current core governed set.',
    };
  }

  if (key.includes('fantasyscore')) {
    return {
      canonicalTarget: 'Fantasy Score',
      priority: 'medium',
      rationale: 'Potentially useful downstream, but not part of the first core benchmark slice.',
    };
  }

  if (key.includes('fieldgoalsmade')) {
    return {
      canonicalTarget: 'Field Goals Made',
      priority: 'low',
      rationale: 'Niche market for later expansion, not needed for the first baseline slice.',
    };
  }

  if (key.includes('fieldgoalsattempted')) {
    return {
      canonicalTarget: 'Field Goals Attempted',
      priority: 'low',
      rationale: 'Niche market for later expansion, not needed for the first baseline slice.',
    };
  }

  if (key.includes('twopointersmade')) {
    return {
      canonicalTarget: 'Two Pointers Made',
      priority: 'low',
      rationale: 'Niche derivative market.',
    };
  }

  if (key.includes('twopointersattempted')) {
    return {
      canonicalTarget: 'Two Pointers Attempted',
      priority: 'low',
      rationale: 'Niche derivative market.',
    };
  }

  if (key.includes('1q') || key.includes('1h')) {
    return {
      canonicalTarget: 'Period-split derivative',
      priority: 'low',
      rationale: 'Useful later, but not part of the first all-game prop benchmark lane.',
    };
  }

  return {
    canonicalTarget: 'Unknown / manual review',
    priority: 'low',
    rationale: 'Key does not match current heuristic families; inspect raw provider semantics before aliasing.',
  };
}

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  console.log('=== UTV2-320: NBA Alias Gap Report ===\n');

  const { data: offerRows, error: offerError } = await db
    .from('provider_offers')
    .select('provider_key,provider_market_key')
    .eq('sport_key', 'NBA');

  if (offerError) {
    throw new Error(`provider_offers query failed: ${offerError.message}`);
  }

  const { data: aliasRows, error: aliasError } = await db
    .from('provider_market_aliases')
    .select('provider,provider_market_key')
    .eq('sport_id', 'NBA')
    .eq('provider', 'sgo');

  if (aliasError) {
    throw new Error(`provider_market_aliases query failed: ${aliasError.message}`);
  }

  const offers = (offerRows ?? []) as OfferRow[];
  const aliases = new Set(
    ((aliasRows ?? []) as AliasRow[]).map((row) => `${row.provider}::${row.provider_market_key}`),
  );

  const unmappedCounts = new Map<string, number>();
  for (const offer of offers) {
    const compoundKey = `${offer.provider_key}::${offer.provider_market_key}`;
    if (aliases.has(compoundKey)) {
      continue;
    }
    unmappedCounts.set(
      offer.provider_market_key,
      (unmappedCounts.get(offer.provider_market_key) ?? 0) + 1,
    );
  }

  const ordered = [...unmappedCounts.entries()]
    .map(([providerMarketKey, count]) => ({
      providerMarketKey,
      count,
      suggestion: suggestCanonicalTarget(providerMarketKey),
    }))
    .sort((left, right) => right.count - left.count || left.providerMarketKey.localeCompare(right.providerMarketKey));

  const highPriority = ordered.filter((row) => row.suggestion.priority === 'high');
  const mediumPriority = ordered.filter((row) => row.suggestion.priority === 'medium');

  console.log(`Total unmapped provider market keys: ${ordered.length}`);
  console.log(`High-priority candidates:           ${highPriority.length}`);
  console.log(`Medium-priority candidates:         ${mediumPriority.length}`);

  console.log('\n--- High-priority alias candidates ---');
  for (const row of highPriority.slice(0, 15)) {
    console.log(
      `${row.providerMarketKey} | rows=${row.count} | target=${row.suggestion.canonicalTarget} | ${row.suggestion.rationale}`,
    );
  }

  if (mediumPriority.length > 0) {
    console.log('\n--- Medium-priority alias candidates ---');
    for (const row of mediumPriority.slice(0, 10)) {
      console.log(
        `${row.providerMarketKey} | rows=${row.count} | target=${row.suggestion.canonicalTarget} | ${row.suggestion.rationale}`,
      );
    }
  }

  console.log('\n--- Recommendation ---');
  if (highPriority.length === 0) {
    console.log('No obvious high-priority alias gaps remain from current NBA offers.');
    return;
  }

  console.log(
    `Prioritize alias completion for: ${highPriority
      .slice(0, 6)
      .map((row) => row.suggestion.canonicalTarget)
      .join(', ')}`,
  );
}

main().catch((error) => {
  console.error('Alias gap report failed:', error);
  process.exit(1);
});
