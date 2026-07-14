import Link from 'next/link';
import { PRICE_PLACEHOLDER, type Tier } from '@/lib/site-config';

export function PlanCard({ tier }: { tier: Tier }) {
  return (
    <div
      className={`ut-panel ut-notch relative flex h-full flex-col p-6 pt-7 ${
        tier.highlighted ? 'border-[var(--ut-signal)]' : ''
      } ${tier.comingSoon ? 'opacity-80' : ''}`}
    >
      <div
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{
          backgroundColor: tier.highlighted ? 'var(--ut-signal)' : 'var(--ut-border-strong)',
        }}
        aria-hidden="true"
      />
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">{tier.name}</h3>
        {tier.highlighted ? <span className="ut-tag ut-tag-signal">Popular</span> : null}
        {tier.comingSoon ? <span className="ut-tag">Soon</span> : null}
      </div>
      <p className="ut-num mt-4 text-2xl font-bold">
        {tier.price ?? PRICE_PLACEHOLDER}
      </p>
      <p className="ut-text-muted text-xs uppercase tracking-wider">{tier.billing}</p>
      <p className="ut-text-secondary mt-4 text-sm leading-relaxed">{tier.summary}</p>
      <ul className="mt-5 flex-1 space-y-2.5">
        {tier.features.map((feature) => (
          <li key={feature} className="ut-text-secondary flex items-start gap-2 text-sm">
            <span aria-hidden="true" className="ut-num mt-0.5 text-[var(--ut-tick-pos)]">
              +
            </span>
            {feature}
          </li>
        ))}
      </ul>
      {tier.comingSoon ? (
        <span
          className="ut-btn ut-btn-secondary ut-notch-sm mt-6 cursor-default opacity-60"
          aria-disabled="true"
        >
          {tier.cta}
        </span>
      ) : (
        <Link
          href="/contact"
          className={`ut-btn ut-notch-sm mt-6 ${tier.highlighted ? 'ut-btn-primary' : 'ut-btn-secondary'}`}
        >
          {tier.cta}
        </Link>
      )}
    </div>
  );
}
