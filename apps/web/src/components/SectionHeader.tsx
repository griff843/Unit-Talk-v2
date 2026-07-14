export function SectionHeader({
  eyebrow,
  title,
  lead,
  align = 'left',
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  align?: 'left' | 'center';
}) {
  const wrap = align === 'center' ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl';
  return (
    <div className={wrap}>
      {eyebrow ? <p className="ut-eyebrow">{eyebrow}</p> : null}
      <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
      {lead ? <p className="ut-text-secondary mt-3 text-sm leading-relaxed sm:text-base">{lead}</p> : null}
    </div>
  );
}
