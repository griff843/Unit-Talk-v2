export default function SubmitPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="slip-card max-w-sm w-full text-center space-y-4 py-10">
        <p className="section-label">Unit Talk</p>
        <h1 className="text-2xl font-condensed font-semibold tracking-tight text-foreground">
          Submit Pick
        </h1>
        <p className="text-sm text-muted-foreground">
          Bet slip form — Phase 3 incoming
        </p>
        <div className="field-divider" />
        <p className="data-value text-xs text-muted-foreground">
          API → http://127.0.0.1:4000
        </p>
      </div>
    </main>
  );
}
