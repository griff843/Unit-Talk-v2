export function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-5">
      {title && (
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">
          {title}
        </h2>
      )}
      {children}
    </div>
  );
}
