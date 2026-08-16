export function SectionHeader({
  eyebrow,
  title,
  lead,
  align = 'center',
  tone = 'accent',
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  align?: 'center' | 'left';
  tone?: 'accent' | 'gold';
}) {
  const wrap = align === 'center' ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl text-left';

  return (
    <div className={wrap}>
      {eyebrow ? <p className={`ut-eyebrow ${tone === 'gold' ? 'ut-eyebrow-gold' : ''}`}>{eyebrow}</p> : null}
      <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
      {lead ? <p className="ut-text-secondary mt-3 text-sm leading-relaxed sm:text-base">{lead}</p> : null}
    </div>
  );
}
