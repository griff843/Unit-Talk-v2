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
    <div className="border-b border-[var(--ut-border-subtle)] bg-[var(--ut-bg-surface)]">
      <div className="mx-auto max-w-3xl px-4 pb-12 pt-16 text-center sm:px-6">
        {eyebrow ? <p className="ut-eyebrow mx-auto justify-center">{eyebrow}</p> : null}
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        {lead ? <p className="ut-text-secondary mt-4 text-base leading-relaxed sm:text-lg">{lead}</p> : null}
      </div>
    </div>
  );
}
