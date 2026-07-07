export function LegalDisclaimer({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--ut-warning)] bg-[var(--ut-bg-surface-elevated)] px-5 py-4">
      <p className="text-sm font-semibold text-[var(--ut-warning)]">Draft — pending legal review</p>
      <p className="ut-text-secondary mt-2 text-sm leading-relaxed">{children}</p>
    </div>
  );
}
