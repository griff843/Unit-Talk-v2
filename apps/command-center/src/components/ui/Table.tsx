export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}

export function TableHead({ children }: { children: React.ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-gray-700 text-xs uppercase text-gray-400">{children}</tr>
    </thead>
  );
}

export function TableBody({ children }: { children: React.ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function Th({ children }: { children: React.ReactNode }) {
  return <th className="py-2 pr-4">{children}</th>;
}

export function Td({ children }: { children?: React.ReactNode }) {
  return <td className="py-2 pr-4 text-xs text-gray-300">{children}</td>;
}
