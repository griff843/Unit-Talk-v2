export function PageHeader({
  eyebrow = 'Unit Talk',
  title,
  lead,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
}) {
  return (
    <div className="ut-page-header">
      <div className="ut-wrap">
        <p className="ut-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {lead ? <p className="ut-lead">{lead}</p> : null}
      </div>
    </div>
  );
}
