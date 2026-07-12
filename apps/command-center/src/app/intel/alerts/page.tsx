'use client';

import { useMemo, useState } from 'react';
import { Card, InternalLabelBadge, UncertifiedBanner } from '@/components/ui';
import {
  createEmptyAlertDefinition,
  validateAlertDefinition,
  type AlertDefinition,
} from '@/lib/alert-builder';

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

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              disabled
              className="cursor-not-allowed rounded bg-gray-700 px-4 py-1.5 text-xs font-medium text-gray-400"
              title="Persistence data contract needed"
            >
              Save (disabled)
            </button>
            <span className="cc-text-muted text-[11px]">
              Persistence data contract needed — no alert_definitions table or apps/api endpoint
              exists yet.
            </span>
          </div>
        </Card>

        <Card title="Live JSON Preview">
          <pre className="overflow-x-auto rounded bg-gray-900/70 p-3 text-[11px] leading-relaxed text-gray-300">
            {JSON.stringify(definition, null, 2)}
          </pre>
        </Card>
      </div>
    </div>
  );
}
