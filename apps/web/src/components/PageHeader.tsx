export function PageHeader({
  title,
  lead,
}: {
  title: string;
  lead?: string;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-10 pt-16 text-center sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
      {lead ? <p className="ut-text-secondary mt-4 text-base leading-relaxed sm:text-lg">{lead}</p> : null}
    </div>
  );
}
