import Link from 'next/link';
import type { Tier } from '@/lib/site-config';
import { CTAButton } from './CTAButton';
export function PlanCard({
  tier,
  showCheckout = false,
}: {
  tier: Tier;
  showCheckout?: boolean;
}) {
  return (
    <article
      id={tier.id}
      className={`ut-plan ${tier.highlighted ? 'ut-plan-highlight' : ''} ${tier.id === 'vip-plus' || tier.id === 'black-label' ? 'ut-plan-reserved' : ''}`}
    >
      <div className="flex items-center justify-between gap-3">
        <h3>{tier.name}</h3>
        {tier.highlighted ? (
          <span className="ut-tag ut-tag-signal">Official picks</span>
        ) : null}
      </div>
      <p className="ut-plan-price">{tier.price}</p>
      <p className="ut-text-muted mt-1 text-sm">{tier.billing}</p>
      <p className="ut-plan-summary">{tier.summary}</p>
      <ul>
        {tier.features.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
      <p className="ut-plan-state">{tier.state}</p>
      {showCheckout && tier.checkoutHref && tier.checkoutCta ? (
        <CTAButton href={tier.checkoutHref}>{tier.checkoutCta}</CTAButton>
      ) : tier.href && tier.cta ? (
        <Link
          href={tier.href}
          className={`ut-btn ${tier.highlighted ? 'ut-btn-primary' : 'ut-btn-secondary'}`}
        >
          {tier.cta}
        </Link>
      ) : null}
    </article>
  );
}
