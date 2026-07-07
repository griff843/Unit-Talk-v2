export type MemberTier = 'free' | 'trial' | 'vip' | 'vip_plus' | 'syndicate';
export type IssueTier = 'T1' | 'T2' | 'T3';

const memberTierStyles: Record<MemberTier, { label: string; className: string }> = {
  free: { label: 'Free', className: 'bg-slate-500/20 text-slate-300 border-slate-500/30' },
  trial: { label: 'Trial', className: 'bg-slate-500/20 text-slate-300 border-slate-500/30' },
  vip: { label: 'VIP', className: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  vip_plus: { label: 'VIP+', className: 'bg-orange-500/20 text-orange-300 border-orange-500/30' },
  syndicate: { label: 'Syndicate', className: 'bg-violet-500/20 text-violet-300 border-violet-500/30' },
};

const issueTierStyles: Record<IssueTier, string> = {
  T1: 'bg-red-500/20 text-red-300 border-red-500/30',
  T2: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  T3: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
};

export function TierBadge({ tier }: { tier: MemberTier }) {
  const style = memberTierStyles[tier];
  return (
    <span className={`inline-block whitespace-nowrap rounded border px-2 py-0.5 text-xs font-bold ${style.className}`}>
      {style.label}
    </span>
  );
}

export function IssueTierBadge({ tier }: { tier: IssueTier }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded border px-2 py-0.5 text-xs font-bold ${issueTierStyles[tier]}`}>
      {tier}
    </span>
  );
}

export function RoleBadge({ role }: { role: string }) {
  return (
    <span className="inline-block whitespace-nowrap rounded border border-[var(--cc-border-strong)] px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-[var(--cc-text-secondary)]">
      {role}
    </span>
  );
}
