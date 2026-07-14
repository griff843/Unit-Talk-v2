export interface FAQItem {
  question: string;
  answer: React.ReactNode;
}

export function FAQAccordion({ items }: { items: FAQItem[] }) {
  return (
    <div className="border-t border-[var(--ut-border-subtle)]">
      {items.map((item, i) => (
        <details key={item.question} className="group border-b border-[var(--ut-border-subtle)] py-4">
          <summary className="flex cursor-pointer list-none items-start gap-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            <span className="ut-num shrink-0 pt-0.5 text-xs text-[var(--ut-signal)]">
              Q{String(i + 1).padStart(2, '0')}
            </span>
            <span className="flex-1">{item.question}</span>
            <span
              aria-hidden="true"
              className="ut-text-muted mt-0.5 shrink-0 text-base transition-transform group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <div className="ut-text-secondary mt-3 pl-9 text-sm leading-relaxed">{item.answer}</div>
        </details>
      ))}
    </div>
  );
}
