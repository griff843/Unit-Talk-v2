'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, InternalLabelBadge, UncertifiedBanner } from '@/components/ui';
import {
  createEmptyAlertDefinition,
  parseSavedAlertDefinitions,
  validateAlertDefinition,
  type AlertDefinition,
  type SavedAlertDefinition,
} from '@/lib/alert-builder';

const savedDefinitionsStorageKey = 'unit-talk.command-center.alert-definitions.v1';

function numOrNull(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

const inputCls =
  'w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none';
const labelCls = 'cc-text-muted text-[10px] font-medium uppercase tracking-wide';

export default function AlertBuilderPage() {
  const [sport, setSport] = useState('');
  const [league, setLeague] = useState('');
  const [market, setMarket] = useState('');
  const [book, setBook] = useState('');
  const [oddsThreshold, setOddsThreshold] = useState('');
  const [evThreshold, setEvThreshold] = useState('');
  const [lineMoveThreshold, setLineMoveThreshold] = useState('');
  const [playerOrTeam, setPlayerOrTeam] = useState('');
  const [startWindow, setStartWindow] = useState('');
  const [savedDefinitions, setSavedDefinitions] = useState<SavedAlertDefinition[]>([]);
  const [storageLoaded, setStorageLoaded] = useState(false);

  const definition: AlertDefinition = useMemo(
    () => ({
      ...createEmptyAlertDefinition(),
      sport,
      league,
      market,
      book,
      oddsThreshold: numOrNull(oddsThreshold),
      evThreshold: numOrNull(evThreshold),
      lineMoveThreshold: numOrNull(lineMoveThreshold),
      playerOrTeam,
      startWindow: numOrNull(startWindow),
    }),
    [sport, league, market, book, oddsThreshold, evThreshold, lineMoveThreshold, playerOrTeam, startWindow],
  );

  const validation = useMemo(() => validateAlertDefinition(definition), [definition]);

  useEffect(() => {
    setSavedDefinitions(parseSavedAlertDefinitions(window.localStorage.getItem(savedDefinitionsStorageKey)));
    setStorageLoaded(true);
  }, []);

  function persistSavedDefinitions(next: SavedAlertDefinition[]) {
    setSavedDefinitions(next);
    window.localStorage.setItem(savedDefinitionsStorageKey, JSON.stringify(next));
  }

  function saveDefinition() {
    if (!validation.valid) return;
    persistSavedDefinitions([
      ...savedDefinitions,
      { id: crypto.randomUUID(), savedAt: new Date().toISOString(), definition },
    ]);
  }

  function loadDefinition(saved: SavedAlertDefinition) {
    setSport(saved.definition.sport);
    setLeague(saved.definition.league);
    setMarket(saved.definition.market);
    setBook(saved.definition.book);
    setOddsThreshold(stringOrEmpty(saved.definition.oddsThreshold));
    setEvThreshold(stringOrEmpty(saved.definition.evThreshold));
    setLineMoveThreshold(stringOrEmpty(saved.definition.lineMoveThreshold));
    setPlayerOrTeam(saved.definition.playerOrTeam);
    setStartWindow(stringOrEmpty(saved.definition.startWindow));
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="cc-text-secondary mt-1 text-sm">
          Compose an internal alert definition. Alerts are internal-only and require operator
          approval before any dispatch — both flags are locked on.
        </p>
      </div>

      <UncertifiedBanner what="EV-threshold alerts (internal consensus de-vig)" />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Definition">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="ab-sport" className={labelCls}>Sport *</label>
              <input id="ab-sport" className={inputCls} value={sport} onChange={(e) => setSport(e.target.value)} placeholder="baseball" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="ab-league" className={labelCls}>League</label>
              <input id="ab-league" className={inputCls} value={league} onChange={(e) => setLeague(e.target.value)} placeholder="MLB" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="ab-market" className={labelCls}>Market *</label>
              <input id="ab-market" className={inputCls} value={market} onChange={(e) => setMarket(e.target.value)} placeholder="pitching_strikeouts-all-game-ou" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="ab-book" className={labelCls}>Book</label>
              <input id="ab-book" className={inputCls} value={book} onChange={(e) => setBook(e.target.value)} placeholder="draftkings" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="ab-odds" className={labelCls}>Odds Threshold (American)</label>
              <input id="ab-odds" className={inputCls} value={oddsThreshold} onChange={(e) => setOddsThreshold(e.target.value)} placeholder="+150" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="ab-ev" className={labelCls}>EV Threshold (%)</label>
              <input id="ab-ev" className={inputCls} value={evThreshold} onChange={(e) => setEvThreshold(e.target.value)} placeholder="3" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="ab-move" className={labelCls}>Line Move Threshold</label>
              <input id="ab-move" className={inputCls} value={lineMoveThreshold} onChange={(e) => setLineMoveThreshold(e.target.value)} placeholder="1.5" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="ab-who" className={labelCls}>Player / Team</label>
              <input id="ab-who" className={inputCls} value={playerOrTeam} onChange={(e) => setPlayerOrTeam(e.target.value)} placeholder="AUSTIN_MARTIN_1_MLB" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="ab-window" className={labelCls}>Start Window (hours, 1–168)</label>
              <input id="ab-window" className={inputCls} value={startWindow} onChange={(e) => setStartWindow(e.target.value)} placeholder="24" />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-800 pt-3">
            <span className={labelCls}>Locked governance flags:</span>
            <InternalLabelBadge label="Internal Only" />
            <InternalLabelBadge label="Approval Required" />
            <span className="cc-text-muted text-[11px]">destination: internal (fixed)</span>
          </div>

          <div className="mt-4 border-t border-gray-800 pt-3">
            {validation.valid ? (
              <p className="text-xs font-medium text-emerald-400">Definition valid.</p>
            ) : (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-yellow-400">
                {validation.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!validation.valid || !storageLoaded}
              onClick={saveDefinition}
              className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400"
              title="Save this internal-only definition in this browser"
            >
              Save locally
            </button>
            <span className="cc-text-muted text-[11px]">
              Saved in this browser only. No alert_definitions table, API persistence, or dispatch
              path exists.
            </span>
          </div>
        </Card>

        <Card title="Live JSON Preview">
          <pre className="overflow-x-auto rounded bg-gray-900/70 p-3 text-[11px] leading-relaxed text-gray-300">
            {JSON.stringify(definition, null, 2)}
          </pre>
        </Card>
      </div>

      <Card title="Saved Definitions">
        <p className="cc-text-muted text-xs">
          Browser-local internal filters. Loading or saving one cannot create, approve, or dispatch an alert.
        </p>
        {storageLoaded && savedDefinitions.length === 0 ? (
          <p className="cc-text-muted mt-3 text-xs">No saved definitions in this browser.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {savedDefinitions.map((saved) => (
              <li key={saved.id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-gray-800 bg-gray-900/50 p-3 text-xs">
                <span className="text-gray-300">
                  {saved.definition.sport} · {saved.definition.market}
                  {saved.definition.book ? ` · ${saved.definition.book}` : ''}
                </span>
                <div className="flex items-center gap-3">
                  <span className="cc-text-muted">{new Date(saved.savedAt).toLocaleString()}</span>
                  <button type="button" onClick={() => loadDefinition(saved)} className="text-blue-400 hover:text-blue-300">
                    Load
                  </button>
                  <button
                    type="button"
                    onClick={() => persistSavedDefinitions(savedDefinitions.filter(({ id }) => id !== saved.id))}
                    className="text-red-400 hover:text-red-300"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function stringOrEmpty(value: number | null): string {
  return value === null ? '' : String(value);
}
