import Link from 'next/link';
import { PRICE_PLACEHOLDER, type Tier } from '@/lib/site-config';

export function PlanCard({ tier }: { tier: Tier }) {
  return (
    <div
      className={`ut-surface relative flex h-full flex-col p-6 ${
        tier.highlighted ? 'border-[var(--ut-accent)]' : ''
      }`}
    >
      {tier.highlighted ? (
        <span className="absolute -top-3 left-6 rounded-full bg-[var(--ut-accent)] px-3 py-0.5 text-xs font-semibold text-white">
          Most Popular
        </span>
      ) : null}
      {tier.comingSoon ? <span className="ut-badge absolute -top-3 right-6 bg-[var(--ut-bg-surface)]">Coming Soon</span> : null}
      <h3 className="text-lg font-semibold">{tier.name}</h3>
      <p className="mt-2 text-sm font-medium text-[var(--ut-accent)]">
        {tier.price ?? PRICE_PLACEHOLDER}
      </p>
      <p className="ut-text-secondary mt-3 text-sm leading-relaxed">{tier.summary}</p>
      <ul className="mt-5 flex-1 space-y-2">
        {tier.features.map((feature) => (
          <li key={feature} className="ut-text-secondary flex items-start gap-2 text-sm">
            <span aria-hidden="true" className="mt-0.5 text-[var(--ut-success)]">
              ✓
            </span>
            {feature}
          </li>
        ))}
      </ul>
      {tier.comingSoon ? (
        <span className="ut-btn-secondary mt-6 cursor-default opacity-60" aria-disabled="true">
          {tier.cta}
        </span>
      ) : (
        <Link
          href="/contact"
          className={`${tier.highlighted ? 'ut-btn-primary' : 'ut-btn-secondary'} mt-6`}
        >
          {tier.cta}
        </Link>
      )}
    </div>
  );
}
