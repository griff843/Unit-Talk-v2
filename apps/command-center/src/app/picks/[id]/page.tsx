import { CorrectionForm } from '@/components/CorrectionForm';
import { SettlementForm } from '@/components/SettlementForm';

interface PickDetailPageProps {
  params: { id: string };
  searchParams: { status?: string };
}

/**
 * Pick detail page.
 *
 * Renders the appropriate settlement or correction surface based on the
 * pick's current lifecycle status, which can be passed as a `?status=`
 * query parameter from the picks pipeline table.
 *
 * - status not yet settled → SettlementForm
 * - status === 'settled'   → CorrectionForm
 * - status === 'voided'    → informational message only
 */
export default function PickDetailPage({ params, searchParams }: PickDetailPageProps) {
  const pickId = params.id;
  const status = searchParams.status ?? '';

  const isSettled = status === 'settled';
  const isVoided = status === 'voided';

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-bold text-gray-100">Pick Detail</h1>
        <p className="mt-1 font-mono text-sm text-gray-400">{pickId}</p>
        {status && (
          <p className="mt-1 text-sm text-gray-500">
            Status: <span className="font-medium text-gray-300">{status}</span>
          </p>
        )}
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
        {isVoided ? (
          <p className="text-sm text-gray-400">
            Pick is voided — no further action available.
          </p>
        ) : isSettled ? (
          <CorrectionForm pickId={pickId} />
        ) : (
          <SettlementForm pickId={pickId} isAlreadySettled={false} />
        )}
      </div>
    </div>
  );
}
