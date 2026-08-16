import Link from 'next/link';
import { PRICE_PLACEHOLDER, type Tier } from '@/lib/site-config';

export function PlanCard({ tier }: { tier: Tier }) {
  const isGold = tier.id === 'vip-plus';
  const isSyndicate = tier.id === 'syndicate';

  return (
    <div
      className={`ut-surface ut-card-hover relative flex h-full flex-col p-6 ${
        tier.highlighted ? 'border-[var(--ut-accent)]' : ''
      } ${isGold ? 'ut-gold-border lg:-translate-y-2' : ''} ${
        isSyndicate ? 'border-dashed border-[var(--ut-border-strong)] bg-transparent' : ''
      }`}
    >
      {tier.highlighted ? (
        <span className="absolute -top-3 left-6 rounded-full bg-[var(--ut-accent)] px-3 py-0.5 text-xs font-semibold text-[#04110e]">
          Most Popular
        </span>
      ) : null}
      {isGold ? (
        <span className="absolute -top-3 left-6 rounded-full bg-[var(--ut-gold)] px-3 py-0.5 text-xs font-semibold text-[#1a1204]">
          Premium
        </span>
      ) : null}
      {tier.comingSoon ? (
        <span className="ut-badge absolute -top-3 right-6 bg-[var(--ut-bg-surface)]">
          {isSyndicate ? 'Application Only' : 'Coming Soon'}
        </span>
      ) : null}
      <h3 className="text-lg font-semibold">{tier.name}</h3>
      <p
        className={`mt-2 text-sm font-medium ${
          isGold ? 'text-[var(--ut-gold)]' : isSyndicate ? 'ut-text-muted' : 'text-[var(--ut-accent)]'
        }`}
      >
        {tier.price ?? PRICE_PLACEHOLDER}
      </p>
      <p className="ut-text-secondary mt-3 text-sm leading-relaxed">{tier.summary}</p>
      <ul className="mt-5 flex-1 space-y-2">
        {tier.features.map((feature) => (
          <li key={feature} className="ut-text-secondary flex items-start gap-2 text-sm">
            <span
              aria-hidden="true"
              className={`mt-0.5 ${isGold ? 'text-[var(--ut-gold)]' : 'text-[var(--ut-success)]'}`}
            >
              ✓
            </span>
            {feature}
          </li>
        ))}
      </ul>
      {tier.comingSoon ? (
        <Link href="/contact" className="ut-btn-secondary mt-6" aria-label={`${tier.cta} — apply for ${tier.name}`}>
          {isSyndicate ? 'Apply for Syndicate' : tier.cta}
        </Link>
      ) : (
        <Link
          href="/contact"
          className={`${isGold ? 'ut-btn-gold' : tier.highlighted ? 'ut-btn-primary' : 'ut-btn-secondary'} mt-6`}
        >
          {tier.cta}
        </Link>
      )}
    </div>
  );
}
