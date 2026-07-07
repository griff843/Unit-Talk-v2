export interface FAQItem {
  question: string;
  answer: React.ReactNode;
}

export function FAQAccordion({ items }: { items: FAQItem[] }) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <details key={item.question} className="ut-surface group px-5 py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            {item.question}
            <span
              aria-hidden="true"
              className="ut-text-muted shrink-0 transition-transform group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <div className="ut-text-secondary mt-3 text-sm leading-relaxed">{item.answer}</div>
        </details>
      ))}
    </div>
  );
}
