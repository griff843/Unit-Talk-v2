import { PRICING_TABLE_ROWS } from '@/lib/site-config';

function Cell({ included }: { included: boolean }) {
  return (
    <td className={included ? 'ut-cell-yes' : 'ut-cell-no'}>
      {included ? '✓' : '—'}
    </td>
  );
}

export function PricingTable() {
  return (
    <div className="ut-panel overflow-x-auto">
      <table className="ut-table min-w-[640px]">
        <thead>
          <tr>
            <th>Feature</th>
            <th>Free</th>
            <th>VIP</th>
            <th>VIP+</th>
            <th>Syndicate</th>
          </tr>
        </thead>
        <tbody>
          {PRICING_TABLE_ROWS.map((row) => (
            <tr key={row.feature}>
              <td className="ut-text-secondary">{row.feature}</td>
              <Cell included={row.free} />
              <Cell included={row.vip} />
              <Cell included={row.vipPlus} />
              <Cell included={row.syndicate} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
