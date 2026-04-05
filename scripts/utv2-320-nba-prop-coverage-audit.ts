/**
 * UTV2-320: NBA player-prop canonical coverage audit
 *
 * Queries live Supabase to:
 * 1. Audit which NBA provider market keys are present in provider_offers
 * 2. Measure canonical alias coverage against provider_market_aliases
 * 3. Report stat / combo-stat coverage for the current NBA prop board
 * 4. Highlight missing high-value NBA stat families before baseline work
 *
 * Run: pnpm exec tsx scripts/utv2-320-nba-prop-coverage-audit.ts
 */

import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

type ProviderOfferRow = {
  provider_key: string;
  provider_market_key: string;
  bookmaker_key: string | null;
};

type SportRow = {
  id: string;
};

type AliasRow = {
  provider: string;
  provider_market_key: string;
  market_type_id: string;
  stat_type_id: string | null;
  combo_stat_type_id: string | null;
};

type MarketTypeRow = {
  id: string;
  display_name: string;
};

type StatTypeRow = {
  id: string;
  display_name: string;
  canonical_key: string;
};

type ComboStatTypeRow = {
  id: string;
  display_name: string;
};

const EXPECTED_NBA_STAT_KEYS = [
  'points',
  'rebounds',
  'assists',
  'threes',
  'steals',
  'blocks',
  'turnovers',
  'points_rebounds_assists',
  'points_rebounds',
  'points_assists',
  'rebounds_assists',
] as const;

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  console.log('=== UTV2-320: NBA Player-Prop Canonical Coverage Audit ===\n');

  const { data: sportsRows, error: sportsError } = await db
    .from('sports')
    .select('id')
    .eq('id', 'NBA')
    .limit(1);

  if (sportsError) {
    throw new Error(`sports query failed: ${sportsError.message}`);
  }

  const nbaSport = (sportsRows ?? [])[0] as SportRow | undefined;
  if (!nbaSport) {
    throw new Error('NBA sport row not found');
  }

  const { data: offerRows, error: offerError } = await db
    .from('provider_offers')
    .select('provider_key,provider_market_key,bookmaker_key')
    .eq('sport_key', 'NBA');

  if (offerError) {
    throw new Error(`provider_offers query failed: ${offerError.message}`);
  }

  const offers = (offerRows ?? []) as ProviderOfferRow[];
  const uniqueProviderMarketKeys = [...new Set(offers.map((row) => row.provider_market_key))].sort();
  const providers = [...new Set(offers.map((row) => row.provider_key))].sort();

  const { data: aliasRows, error: aliasError } = await db
    .from('provider_market_aliases')
    .select('provider,provider_market_key,market_type_id,stat_type_id,combo_stat_type_id')
    .eq('sport_id', nbaSport.id)
    .in('provider', providers);

  if (aliasError) {
    throw new Error(`provider_market_aliases query failed: ${aliasError.message}`);
  }

  const aliases = (aliasRows ?? []) as AliasRow[];

  const marketTypeIds = [...new Set(aliases.map((row) => row.market_type_id))];
  const comboStatTypeIds = [
    ...new Set(aliases.map((row) => row.combo_stat_type_id).filter((id): id is string => Boolean(id))),
  ];

  const [{ data: marketRows, error: marketError }, { data: statRows, error: statError }, { data: comboRows, error: comboError }] =
    await Promise.all([
      db.from('market_types').select('id,display_name').in('id', marketTypeIds.length > 0 ? marketTypeIds : ['']),
      db.from('stat_types').select('id,display_name,canonical_key').eq('sport_id', nbaSport.id),
      db
        .from('combo_stat_types')
        .select('id,display_name')
        .eq('sport_id', nbaSport.id)
        .in('id', comboStatTypeIds.length > 0 ? comboStatTypeIds : ['']),
    ]);

  if (marketError) {
    throw new Error(`market_types query failed: ${marketError.message}`);
  }
  if (statError) {
    throw new Error(`stat_types query failed: ${statError.message}`);
  }
  if (comboError) {
    throw new Error(`combo_stat_types query failed: ${comboError.message}`);
  }

  const marketById = new Map(((marketRows ?? []) as MarketTypeRow[]).map((row) => [row.id, row.display_name]));
  const statById = new Map(((statRows ?? []) as StatTypeRow[]).map((row) => [row.id, row]));
  const comboById = new Map(((comboRows ?? []) as ComboStatTypeRow[]).map((row) => [row.id, row.display_name]));

  const aliasByProviderAndKey = new Map<string, AliasRow>();
  for (const alias of aliases) {
    aliasByProviderAndKey.set(`${alias.provider}::${alias.provider_market_key}`, alias);
  }

  const mappedOfferCount = offers.filter((offer) =>
    aliasByProviderAndKey.has(`${offer.provider_key}::${offer.provider_market_key}`),
  ).length;

  const unmappedKeyCounts = new Map<string, number>();
  for (const offer of offers) {
    if (aliasByProviderAndKey.has(`${offer.provider_key}::${offer.provider_market_key}`)) {
      continue;
    }
    unmappedKeyCounts.set(offer.provider_market_key, (unmappedKeyCounts.get(offer.provider_market_key) ?? 0) + 1);
  }

  const statCoverage = new Map<string, number>();
  const comboCoverage = new Map<string, number>();
  const marketCoverage = new Map<string, number>();
  for (const offer of offers) {
    const alias = aliasByProviderAndKey.get(`${offer.provider_key}::${offer.provider_market_key}`);
    if (!alias) {
      continue;
    }

    const marketName = marketById.get(alias.market_type_id) ?? alias.market_type_id;
    marketCoverage.set(marketName, (marketCoverage.get(marketName) ?? 0) + 1);

    if (alias.stat_type_id) {
      const stat = statById.get(alias.stat_type_id);
      const label = stat?.display_name ?? alias.stat_type_id;
      statCoverage.set(label, (statCoverage.get(label) ?? 0) + 1);
    }

    if (alias.combo_stat_type_id) {
      const label = comboById.get(alias.combo_stat_type_id) ?? alias.combo_stat_type_id;
      comboCoverage.set(label, (comboCoverage.get(label) ?? 0) + 1);
    }
  }

  const availableCanonicalStatKeys = new Set(
    aliases
      .map((alias) => alias.stat_type_id)
      .filter((id): id is string => Boolean(id))
      .map((id) => statById.get(id)?.canonical_key)
      .filter((key): key is string => Boolean(key)),
  );
  const availableComboLabels = new Set(
    aliases
      .map((alias) => alias.combo_stat_type_id)
      .filter((id): id is string => Boolean(id))
      .map((id) => comboById.get(id))
      .filter((label): label is string => Boolean(label)),
  );

  console.log('--- Offer / alias coverage ---');
  console.log(`Total NBA offer rows:            ${offers.length}`);
  console.log(`Unique provider market keys:     ${uniqueProviderMarketKeys.length}`);
  console.log(`Providers present:               ${providers.join(', ') || '(none)'}`);
  console.log(`Rows with canonical alias:       ${mappedOfferCount}`);
  console.log(`Rows without canonical alias:    ${offers.length - mappedOfferCount}`);
  console.log(
    `Alias coverage percent:          ${offers.length === 0 ? 0 : Math.round((mappedOfferCount / offers.length) * 10000) / 100}%`,
  );

  console.log('\n--- Canonical market coverage ---');
  for (const [market, count] of [...marketCoverage.entries()].sort((left, right) => right[1] - left[1])) {
    console.log(`  ${market}: ${count}`);
  }

  console.log('\n--- Canonical stat coverage ---');
  for (const [label, count] of [...statCoverage.entries()].sort((left, right) => right[1] - left[1])) {
    console.log(`  ${label}: ${count}`);
  }

  if (comboCoverage.size > 0) {
    console.log('\n--- Canonical combo-stat coverage ---');
    for (const [label, count] of [...comboCoverage.entries()].sort((left, right) => right[1] - left[1])) {
      console.log(`  ${label}: ${count}`);
    }
  }

  const missingExpectedKeys = EXPECTED_NBA_STAT_KEYS.filter((key) => !availableCanonicalStatKeys.has(key));
  const expectedComboMissing = ['Points + Rebounds + Assists', 'Points + Rebounds', 'Points + Assists', 'Rebounds + Assists']
    .filter((label) => !availableComboLabels.has(label));

  console.log('\n--- Expected NBA prop families ---');
  console.log(`Present canonical stat keys:     ${[...availableCanonicalStatKeys].sort().join(', ') || '(none)'}`);
  console.log(`Missing core stat keys:          ${missingExpectedKeys.join(', ') || '(none)'}`);
  console.log(`Missing combo stat labels:       ${expectedComboMissing.join(', ') || '(none)'}`);

  if (unmappedKeyCounts.size > 0) {
    console.log('\n--- Top unmapped provider market keys ---');
    for (const [marketKey, count] of [...unmappedKeyCounts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 15)) {
      console.log(`  ${marketKey}: ${count}`);
    }
  }

  console.log('\n--- Recommendation ---');
  if (mappedOfferCount === 0) {
    console.log('No canonical NBA prop aliases are landing on current offers. Fix alias coverage before any baseline work.');
  } else if (missingExpectedKeys.length > 0) {
    console.log('NBA prop aliasing is partially live, but important stat families are still missing. Complete canonical mapping before claiming model-readiness.');
  } else {
    console.log('NBA prop aliasing covers the core stat families. Proceed to feature extraction / benchmark plumbing next.');
  }
}

main().catch((error) => {
  console.error('Coverage audit failed:', error);
  process.exit(1);
});
