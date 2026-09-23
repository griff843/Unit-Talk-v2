import React from 'react';
import { Card } from './ui/Card';
import { getSettlementRecapStatus } from '@/lib/data/recap';
import { resolveEffectiveSettlement, type SettlementInput } from '../../../../packages/domain/dist/outcomes/settlement-downstream.js';

interface SettlementReference { id: string; status: string; result: string | null; correctsId: string | null; confidence: string | null; settledAt: string | null }
export async function RecapStatusPanel({ pickId, settlements, verifiedNoDelivery }: {
  pickId: string; settlements: SettlementReference[]; verifiedNoDelivery: boolean;
}) {
  if (settlements.length === 0) return <Card title="Settlement recap"><p>No recap is due before settlement.</p></Card>;
  try {
    const ids = new Set(settlements.map((row) => row.id));
    if (settlements.some((row) => !['settled', 'manual_review'].includes(row.status) || (row.correctsId !== null && !ids.has(row.correctsId)))) throw new Error('Incomplete settlement chain');
    const resolved = resolveEffectiveSettlement(settlements.map((row): SettlementInput => ({
      id: row.id, pick_id: pickId, status: row.status as SettlementInput['status'], result: row.result,
      corrects_id: row.correctsId, confidence: row.confidence ?? 'pending', settled_at: row.settledAt ?? '',
    })));
    if (!resolved.ok || resolved.settlement.correction_depth + 1 !== settlements.length) throw new Error('Unresolved settlement chain');
    if (resolved.settlement.status !== 'settled') return <Card title="Settlement recap"><p>No recap is due while the current settlement requires review.</p></Card>;
    const recap = await getSettlementRecapStatus(pickId, resolved.settlement.effective_record_id, verifiedNoDelivery);
    return <Card title="Settlement recap">
      <div data-testid="settlement-recap" className="space-y-2 text-sm">
        <p className={recap.state === 'unavailable' ? 'font-semibold text-amber-200' : 'font-semibold text-gray-100'}>{recap.title}</p>
        <p className="text-gray-300">{recap.description}</p>
        {recap.channel ? <p className="break-all text-gray-400">Destination: {recap.channel}</p> : null}
        {recap.postedAt ? <p className="text-gray-400">Posted: {new Date(recap.postedAt).toLocaleString('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' })}</p> : null}
        <p className="break-all text-xs text-gray-500">Settlement: {resolved.settlement.effective_record_id}</p>
        {recap.evidenceId ? <p className="break-all text-xs text-gray-500">Evidence: {recap.evidenceId}</p> : null}
      </div>
    </Card>;
  } catch {
    return <Card title="Settlement recap"><p className="text-sm text-amber-200">Recap evidence could not be verified. Pick history remains available; check again before retrying a recap.</p></Card>;
  }
}
