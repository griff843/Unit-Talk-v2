export function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 p-4">
      {title && <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">{title}</h2>}
      {children}
    </div>
  );
}
