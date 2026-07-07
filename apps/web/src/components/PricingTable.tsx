import { TIERS } from '@/lib/site-config';

interface FeatureRow {
  feature: string;
  values: [string, string, string, string]; // Free, VIP, VIP+, Syndicate
}

const ROWS: FeatureRow[] = [
  { feature: 'Public Discord channels', values: ['✓', '✓', '✓', '✓'] },
  { feature: 'Community discussion', values: ['✓', '✓', '✓', '✓'] },
  { feature: 'Structured expert picks', values: ['—', '✓', '✓', '✓'] },
  { feature: 'Pick alerts', values: ['—', '✓', 'Priority', 'Priority'] },
  { feature: 'Market context', values: ['—', '✓', 'Expanded', 'Expanded'] },
  { feature: 'Best Bet previews', values: ['—', '—', '✓', '✓'] },
  { feature: 'Members-only channels', values: ['—', 'VIP', 'VIP+', 'Syndicate'] },
  { feature: 'Syndicate-grade briefings', values: ['—', '—', '—', 'Coming Soon'] },
];

export function PricingTable() {
  return (
    <div className="ut-surface overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <caption className="sr-only">Feature comparison across Unit Talk tiers</caption>
        <thead>
          <tr className="border-b border-[var(--ut-border-subtle)]">
            <th scope="col" className="px-4 py-3 font-semibold">
              Feature
            </th>
            {TIERS.map((tier) => (
              <th scope="col" key={tier.id} className="px-4 py-3 font-semibold">
                {tier.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.feature} className="border-b border-[var(--ut-border-subtle)] last:border-b-0">
              <th scope="row" className="ut-text-secondary px-4 py-3 font-normal">
                {row.feature}
              </th>
              {row.values.map((value, i) => (
                <td key={TIERS[i].id} className="ut-text-secondary px-4 py-3">
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
