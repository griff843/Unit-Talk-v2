export function LegalDisclaimer({ children }: { children: React.ReactNode }) {
  return (
    <div className="ut-panel ut-notch-sm border-l-2 border-l-[var(--ut-signal)] px-5 py-4">
      <p className="ut-tag ut-tag-signal">Draft — pending legal review</p>
      <p className="ut-text-secondary mt-3 text-sm leading-relaxed">{children}</p>
    </div>
  );
}
