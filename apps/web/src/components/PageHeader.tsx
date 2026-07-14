export function PageHeader({
  eyebrow,
  title,
  lead,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
}) {
  return (
    <div className="ut-grid-texture border-b border-[var(--ut-border-subtle)] bg-[var(--ut-bg-surface)]">
      <div className="mx-auto max-w-4xl px-4 pb-14 pt-20 sm:px-6">
        <p className="ut-eyebrow">{eyebrow ?? 'Unit Talk'}</p>
        <h1 className="mt-4 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        {lead ? (
          <p className="ut-text-secondary mt-4 max-w-xl text-base leading-relaxed sm:text-lg">{lead}</p>
        ) : null}
      </div>
    </div>
  );
}
