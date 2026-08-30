'use client';

import { FormEvent, useState } from 'react';
import { SettlementForm } from '@/components/SettlementForm';

export function SettlementWorkbench() {
  const [input, setInput] = useState('');
  const [pickId, setPickId] = useState<string | null>(null);

  function openPick(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = input.trim();
    setPickId(normalized.length > 0 ? normalized : null);
  }

  return (
    <section className="cc-surface p-5" aria-labelledby="settlement-workbench-heading">
      <div className="max-w-3xl">
        <h2 id="settlement-workbench-heading" className="text-sm font-semibold uppercase tracking-wide cc-text-secondary">
          Governed settlement action
        </h2>
        <p className="mt-2 text-sm cc-text-muted">
          Enter a canonical pick ID. Submitting uses the existing Command Center server action and canonical API;
          correction records append and never overwrite the original.
        </p>
        <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={openPick}>
          <label className="sr-only" htmlFor="settlement-pick-id">Canonical pick ID</label>
          <input
            id="settlement-pick-id"
            className="cc-input min-w-0 flex-1 font-mono"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Canonical pick ID"
            autoComplete="off"
          />
          <button
            type="submit"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
          >
            Load settlement controls
          </button>
        </form>
      </div>
      {pickId ? (
        <div className="mt-6 border-t border-gray-800 pt-5">
          <p className="mb-3 text-xs cc-text-muted">Target pick: <span className="font-mono text-gray-300">{pickId}</span></p>
          <SettlementForm pickId={pickId} isAlreadySettled={false} />
        </div>
      ) : null}
    </section>
  );
}
