export interface FAQItem {
  id?: string;
  question: string;
  answer: React.ReactNode;
}
export function FAQAccordion({ items }: { items: readonly FAQItem[] }) {
  return (
    <div className="border-t border-[var(--ut-border-subtle)]">
      {items.map((item, index) => (
        <details
          id={item.id}
          key={item.question}
          className="group border-b border-[var(--ut-border-subtle)] py-2"
        >
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            <span
              className="ut-num shrink-0 text-xs text-[var(--ut-signal)]"
              aria-hidden="true"
            >
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="flex-1">{item.question}</span>
            <span
              aria-hidden="true"
              className="ut-text-muted shrink-0 text-xl transition-transform group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <div className="ut-text-secondary pb-4 pl-8 text-sm leading-relaxed">
            {item.answer}
          </div>
        </details>
      ))}
    </div>
  );
}
