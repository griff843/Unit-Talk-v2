import Link from 'next/link';
import { buildPickIdentity, type PickIdentityInput } from '@/lib/pick-identity';

interface PickIdentityPanelProps {
  pick: PickIdentityInput;
  pickId?: string;
  href?: string;
  compact?: boolean;
}

function MetaPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full border border-gray-700 bg-gray-900/80 px-2 py-1 text-[11px] text-gray-300">
      <span className="text-gray-500">{label}:</span> {value}
    </span>
  );
}

export function PickIdentityPanel({
  pick,
  pickId,
  href,
  compact = false,
}: PickIdentityPanelProps) {
  const identity = buildPickIdentity(pick);
  const titleClass = compact ? 'text-sm font-semibold text-gray-100' : 'text-xl font-bold text-white';
  const subtitleClass = compact ? 'text-xs text-gray-400' : 'text-sm text-gray-300';
  const fallbackContext =
    [identity.player, identity.team].filter(Boolean).join(' • ') || 'Missing game or player context';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        {href ? (
          <Link href={href} className={`${titleClass} hover:text-blue-300 hover:underline`}>
            {identity.wagerLabel}
          </Link>
        ) : (
          <h1 className={titleClass}>{identity.wagerLabel}</h1>
        )}
        {pickId ? (
          <span className="font-mono text-[11px] text-gray-500">{pickId}</span>
        ) : null}
      </div>

      <div className={subtitleClass}>{identity.matchup ?? fallbackContext}</div>

      <div className="flex flex-wrap gap-2">
        {identity.sport ? <MetaPill label="Sport" value={identity.sport} /> : null}
        {identity.marketType ? <MetaPill label="Market" value={identity.marketType} /> : null}
        {identity.eventStartLabel ? <MetaPill label="Start" value={identity.eventStartLabel} /> : null}
        {identity.sportsbook ? <MetaPill label="Book" value={identity.sportsbook} /> : null}
        {identity.capper ? <MetaPill label="Capper" value={identity.capper} /> : null}
        {identity.source ? <MetaPill label="Source" value={identity.source} /> : null}
        {identity.oddsLabel ? <MetaPill label="Odds" value={identity.oddsLabel} /> : null}
      </div>
    </div>
  );
}
