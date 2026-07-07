// Standard internal status vocabulary for Command Center surfaces.
// These labels are internal-only and must never be rendered on public pages.

export type InternalLabel =
  | 'Healthy'
  | 'Stale'
  | 'Blocked'
  | 'Needs PM'
  | 'Approvalable'
  | 'Retryable'
  | 'Dead Letter'
  | 'Pending'
  | 'Sent'
  | 'Settled'
  | 'Failed'
  | 'Unverified'
  | 'Certified'
  | 'Not Certified'
  | 'Internal Only'
  | 'Do Not Publicly Claim'
  | 'Data Missing'
  | 'Model Pending'
  | 'Approval Required'
  | 'Stale Odds'
  | 'Needs Review';

const toneByLabel: Record<InternalLabel, string> = {
  Healthy: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  Sent: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  Settled: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  Certified: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  Approvalable: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
  Pending: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
  Retryable: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  Stale: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  'Stale Odds': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  Unverified: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  'Needs Review': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  'Data Missing': 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  'Model Pending': 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  'Needs PM': 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  'Approval Required': 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  Blocked: 'bg-red-500/20 text-red-400 border-red-500/30',
  Failed: 'bg-red-500/20 text-red-400 border-red-500/30',
  'Dead Letter': 'bg-red-500/20 text-red-400 border-red-500/30',
  'Not Certified': 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  'Internal Only': 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  'Do Not Publicly Claim': 'bg-orange-500/20 text-orange-300 border-orange-500/30',
};

export function InternalLabelBadge({ label }: { label: InternalLabel }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded border px-2 py-0.5 text-xs font-bold ${toneByLabel[label]}`}>
      {label}
    </span>
  );
}

/**
 * Banner for modules whose numbers come from internal, uncertified computation
 * (e.g. consensus-devig fair odds). Must appear on every such module.
 */
export function UncertifiedBanner({ what }: { what: string }) {
  return (
    <div
      role="note"
      className="mb-4 rounded-lg border border-orange-500/40 bg-orange-500/10 px-4 py-2 text-xs font-semibold text-orange-300"
    >
      {what} — Uncertified — Internal Only — Do Not Publicly Claim
    </div>
  );
}
