const rows = [
  [
    'Community & complete settled record',
    'Included',
    'Included',
    'Included',
    'Included',
    'Future',
  ],
  [
    'Active official picks before settlement',
    'Not included',
    'Full VIP',
    'Every official pick',
    'Includes VIP',
    'Future',
  ],
  [
    'VIP community, Capper Corner & education',
    'Not included',
    'Full VIP',
    'Included',
    'Includes VIP',
    'Future',
  ],
  [
    'Advanced market intelligence',
    'Not included',
    'Not included',
    'Not included',
    'Final entitlement',
    'Future',
  ],
  [
    'Personal tracking & AI ticket assistance',
    'Not included',
    'Not included',
    'Not included',
    'Final entitlement',
    'Future',
  ],
];
export function PricingTable() {
  return (
    <div
      className="ut-panel overflow-x-auto"
      tabIndex={0}
      role="region"
      aria-label="Membership comparison, scroll horizontally on small screens"
    >
      <table className="ut-table min-w-[760px]">
        <caption className="p-5 text-left text-sm ut-text-secondary">
          Final membership entitlements. Inclusion does not establish current
          activation or availability. Black Label is a future tier.
        </caption>
        <thead>
          <tr>
            <th scope="col">Membership includes</th>
            {['Free', 'Trial', 'VIP', 'VIP+', 'Black Label'].map((name) => (
              <th key={name} scope="col">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, ...values]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              {values.map((value, index) => (
                <td key={index} className="ut-text-secondary">
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
