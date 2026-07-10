'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Table, TableBody, TableHead, Td, Th } from '@/components/ui/Table';
import { ReviewActions } from '@/components/ReviewActions';
import { BulkReviewBar } from '@/components/BulkReviewBar';
import { buildPickIdentity } from '@/lib/pick-identity';
import { buildScoreInsight, scoreToneClasses } from '@/lib/score-insight';

interface ReviewPick {
  id: string;
  source: string;
  market: string;
  selection: string;
  line: number | null;
  odds: number | null;
  stake_units: number | null;
  promotion_score: number | null;
  created_at: string;
  metadata: Record<string, unknown>;
  eventName?: string | null;
  eventStartTime?: string | null;
  sportDisplayName?: string | null;
  capperDisplayName?: string | null;
  marketTypeDisplayName?: string | null;
  settlementResult?: string | null;
  reviewDecision?: string | null;
}

function formatOdds(odds: number | null): string {
  if (odds == null) return '—';
  return odds > 0 ? `+${odds}` : String(odds);
}

function formatCreated(value: string): string {
  const date = new Date(value);
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

export function ReviewQueueClient({ picks, total }: { picks: ReviewPick[]; total: number }) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function togglePick(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === picks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(picks.map((p) => p.id)));
    }
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  if (picks.length === 0) {
    return (
      <Card>
        <p className="text-sm text-gray-500">No picks awaiting review — the queue is clear.</p>
      </Card>
    );
  }

  const allSelected = picks.length > 0 && selectedIds.size === picks.length;

  return (
    <>
      <BulkReviewBar selectedIds={Array.from(selectedIds)} onClearSelection={clearSelection} />

      <div className="cc-surface overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <span className="text-xs text-gray-500">
            Showing {picks.length} of {total} awaiting review
          </span>
          <span className="text-[11px] text-gray-500">
            Routing score reflects promotion policy fit, not win probability.
          </span>
        </div>
        <div className="overflow-x-auto px-4 pb-2">
          <Table>
            <TableHead>
              <Th>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label={`Select all ${picks.length} picks`}
                  className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-950"
                />
              </Th>
              <Th>Pick</Th>
              <Th>Odds</Th>
              <Th>Line</Th>
              <Th>Units</Th>
              <Th>Score</Th>
              <Th>Edge</Th>
              <Th>Created</Th>
              <Th>Actions</Th>
            </TableHead>
            <TableBody>
              {picks.map((pick) => {
                const identity = buildPickIdentity({
                  source: pick.source,
                  market: pick.market,
                  selection: pick.selection,
                  line: pick.line,
                  odds: pick.odds,
                  metadata: pick.metadata,
                  eventName: pick.eventName ?? null,
                  eventStartTime: pick.eventStartTime ?? null,
                  sportDisplayName: pick.sportDisplayName ?? null,
                  capperDisplayName: pick.capperDisplayName ?? null,
                  marketTypeDisplayName: pick.marketTypeDisplayName ?? null,
                });
                const scoreInsight = buildScoreInsight(pick.metadata);
                const isSelected = selectedIds.has(pick.id);
                const isExpanded = expandedId === pick.id;
                return (
                  <ReviewRow
                    key={pick.id}
                    pick={pick}
                    wagerLabel={identity.wagerLabel}
                    matchup={identity.matchup}
                    edgeLabel={scoreInsight.edgeSourceLabel}
                    edgeClass={scoreToneClasses(scoreInsight.reliabilityTone)}
                    isSelected={isSelected}
                    isExpanded={isExpanded}
                    onToggleSelect={() => togglePick(pick.id)}
                    onToggleExpand={() => setExpandedId(isExpanded ? null : pick.id)}
                  />
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </>
  );
}

function ReviewRow({
  pick,
  wagerLabel,
  matchup,
  edgeLabel,
  edgeClass,
  isSelected,
  isExpanded,
  onToggleSelect,
  onToggleExpand,
}: {
  pick: ReviewPick;
  wagerLabel: string;
  matchup: string | null;
  edgeLabel: string;
  edgeClass: string;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
}) {
  return (
    <>
      <tr className={`border-t border-gray-800 ${isExpanded ? 'bg-white/[0.03]' : 'hover:bg-white/[0.02]'}`}>
        <Td>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            aria-label={`Select pick ${pick.id}`}
            className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-950"
          />
        </Td>
        <Td>
          <Link href={`/picks/${pick.id}`} className="font-medium text-gray-100 hover:text-blue-300 hover:underline">
            {wagerLabel}
          </Link>
          <div className="text-[11px] text-gray-500">
            {matchup ?? '—'} · <span className="font-mono">{pick.id.slice(0, 8)}</span>
          </div>
        </Td>
        <Td><span className="font-mono">{formatOdds(pick.odds)}</span></Td>
        <Td><span className="font-mono">{pick.line ?? '—'}</span></Td>
        <Td><span className="font-mono">{pick.stake_units ?? '—'}</span></Td>
        <Td><span className="font-mono font-semibold text-gray-100">{pick.promotion_score != null ? pick.promotion_score.toFixed(1) : '—'}</span></Td>
        <Td>
          <span className={`rounded border px-1.5 py-0.5 text-[10px] ${edgeClass}`}>{edgeLabel}</span>
        </Td>
        <Td><span className="whitespace-nowrap text-gray-400">{formatCreated(pick.created_at)}</span></Td>
        <Td>
          {isSelected ? (
            <span className="text-[11px] italic text-gray-500">bulk</span>
          ) : (
            <button
              type="button"
              onClick={onToggleExpand}
              className="rounded border border-gray-700 px-2 py-1 text-[11px] font-medium text-gray-300 transition-colors hover:bg-white/[0.06] hover:text-gray-100"
              aria-expanded={isExpanded}
            >
              {isExpanded ? 'Close' : 'Review…'}
            </button>
          )}
        </Td>
      </tr>
      {isExpanded && !isSelected && (
        <tr className="border-t border-gray-800/50 bg-white/[0.02]">
          <td colSpan={9} className="px-4 py-3">
            <ReviewActions pickId={pick.id} decisions={['approve', 'deny', 'hold']} />
          </td>
        </tr>
      )}
    </>
  );
}
