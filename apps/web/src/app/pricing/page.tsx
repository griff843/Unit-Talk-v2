import { pageMetadata } from '@/lib/site-metadata';
import type { Metadata } from 'next';
import { CTAButton } from '@/components/CTAButton';
import { PageHeader } from '@/components/PageHeader';
import { PlanCard } from '@/components/PlanCard';
import { PricingTable } from '@/components/PricingTable';
import { ResponsiblePlayBanner } from '@/components/ResponsiblePlayBanner';
import { PAGE_TITLES, TIERS, VIP_PLUS_CAPABILITIES } from '@/lib/site-config';

const description =
  'Free settled history. Full VIP Trial for $1 / 7 days. VIP: every official capper pick for $49.99/month. VIP+ availability unconfirmed; Black Label is a future tier.';
export const metadata: Metadata = pageMetadata(
  PAGE_TITLES.pricing,
  description,
  '/pricing',
);
export default function PricingPage() {
  return (
    <>
      <PageHeader
        eyebrow="Membership"
        title="Start with the record. Choose your access."
        lead="Free → Trial → VIP → VIP+ → Black Label. Every official capper pick belongs in VIP. Advanced intelligence adds to that foundation."
      />
      <section className="ut-wrap ut-section pt-0">
        <div className="ut-notice">
          <span className="ut-status-dot" aria-hidden="true" />
          <p>
            Website checkout is unavailable. The prices below describe the
            approved memberships; these links explain the product and do not
            start a purchase.
          </p>
        </div>
        <h2 className="sr-only">Membership options</h2>
        <div className="ut-plan-grid mt-8">
          {TIERS.slice(0, 3).map((tier) => (
            <PlanCard key={tier.id} tier={tier} />
          ))}
        </div>
        <div className="ut-plan-future mt-6">
          {TIERS.slice(3).map((tier) => (
            <PlanCard key={tier.id} tier={tier} />
          ))}
        </div>
      </section>
      <section className="ut-wrap ut-section ut-section-rule">
        <div className="ut-section-heading">
          <p className="ut-eyebrow">The complete picture</p>
          <h2>Compare membership entitlements.</h2>
          <p className="ut-text-secondary">
            Trial includes full VIP access for seven consecutive days. It does
            not include VIP+. Free includes the complete settled record, not
            active paid picks before settlement.
          </p>
        </div>
        <PricingTable />
      </section>
      <section id="capabilities" className="ut-wrap ut-section ut-section-rule">
        <div className="ut-split">
          <div className="ut-section-heading">
            <p className="ut-eyebrow">VIP+ / capability status</p>
            <h2>Advanced access needs proven availability.</h2>
            <p className="ut-text-secondary">
              These are intended VIP+ capabilities. Current availability is not
              established here, and none is offered for sale through this
              website. VIP+ pricing is not published.
            </p>
          </div>
          <ul className="ut-capability-list">
            {VIP_PLUS_CAPABILITIES.map((item) => (
              <li key={item}>
                <span>{item}</span>
                <span className="ut-state-label">Availability unconfirmed</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="ut-wrap ut-section ut-section-rule">
        <div className="ut-split">
          <div>
            <p className="ut-eyebrow">Before you subscribe</p>
            <h2 className="ut-subheading mt-3">
              Know the terms before paying.
            </h2>
          </div>
          <div>
            <p className="ut-text-secondary leading-relaxed">
              Renewal, cancellation, refunds and repeat-trial eligibility are
              not established on this site. Exact terms must be available before
              purchase. Terms and Privacy remain drafts awaiting legal review.
            </p>
            <div className="ut-actions mt-6">
              <CTAButton href="/faq#billing" variant="secondary">
                Read billing FAQ
              </CTAButton>
              <CTAButton href="/results" variant="secondary">
                Results & transparency
              </CTAButton>
            </div>
          </div>
        </div>
      </section>
      <section className="ut-wrap pb-16">
        <ResponsiblePlayBanner />
      </section>
    </>
  );
}
