import { SettlementForm } from '@/components/SettlementForm';

type SettlementWorkbenchProps = {
  pickId: string | null;
  isAlreadySettled: boolean | null;
  pickLoadError: string | null;
};

export function SettlementWorkbench({
  pickId,
  isAlreadySettled,
  pickLoadError,
}: SettlementWorkbenchProps) {
  return (
    <section className="cc-surface p-5" aria-labelledby="settlement-workbench-heading">
      <div className="max-w-3xl">
        <h2 id="settlement-workbench-heading" className="text-sm font-semibold uppercase tracking-wide cc-text-secondary">
          Governed settlement action
        </h2>
        <p className="mt-2 text-sm cc-text-muted">
          Load a canonical pick before settlement controls are enabled. Submitting uses the existing Command Center
          server action and canonical API; correction records append and never overwrite the original.
        </p>
        <form className="mt-4 flex flex-col gap-3 sm:flex-row" action="/settlement" method="get">
          <label className="sr-only" htmlFor="settlement-pick-id">Canonical pick ID</label>
          <input
            id="settlement-pick-id"
            name="pickId"
            className="cc-input min-w-0 flex-1 font-mono"
            defaultValue={pickId ?? ''}
            placeholder="Canonical pick ID"
            autoComplete="off"
            required
          />
          <button
            type="submit"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
          >
            Load settlement controls
          </button>
        </form>
      </div>

      {pickLoadError ? (
        <div className="mt-6 rounded-md border border-amber-500/35 bg-amber-500/10 p-4 text-sm text-amber-100">
          {pickLoadError} Settlement controls remain disabled.
        </div>
      ) : pickId && isAlreadySettled !== null ? (
        <div className="mt-6 border-t border-gray-800 pt-5">
          <p className="mb-3 text-xs cc-text-muted">
            Authoritative target: <span className="font-mono text-gray-300">{pickId}</span>
          </p>
          <SettlementForm pickId={pickId} isAlreadySettled={isAlreadySettled} />
        </div>
      ) : null}
    </section>
  );
}
