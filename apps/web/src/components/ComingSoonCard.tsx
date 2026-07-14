export function ComingSoonCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="ut-panel ut-notch flex h-full flex-col p-6">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold">{title}</h3>
        <span className="ut-tag shrink-0">Soon</span>
      </div>
      <p className="ut-text-secondary mt-3 text-sm leading-relaxed">{description}</p>
    </div>
  );
}
