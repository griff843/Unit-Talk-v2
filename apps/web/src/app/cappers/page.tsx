import { pageMetadata } from '@/lib/site-metadata';
import type { Metadata } from 'next';
import { CTAButton } from '@/components/CTAButton';
import { PageHeader } from '@/components/PageHeader';
import { PAGE_TITLES } from '@/lib/site-config';
const description =
  'Evaluate Unit Talk cappers through their complete settled record. Public profiles and performance data are unavailable on this website; no biographies or statistics are invented.';
export const metadata: Metadata = pageMetadata(
  PAGE_TITLES.cappers,
  description,
  '/cappers',
);
export default function CappersPage() {
  return (
    <>
      <PageHeader
        eyebrow="Cappers"
        title="Judge the record. Know the source."
        lead="An official pick should have a clear identity and a complete settled history. VIP includes every official capper pick across supported sports."
      />
      <section className="ut-wrap ut-section pt-0">
        <div className="ut-availability-panel">
          <p className="ut-eyebrow">Public capper profiles</p>
          <h2>Profiles are unavailable here.</h2>
          <p className="ut-text-secondary">
            A public capper directory and its settled performance data are not
            connected to this website. We do not substitute invented identities,
            biographies, credentials or records.
          </p>
          <CTAButton href="/results" variant="secondary" className="mt-6">
            Read the results policy
          </CTAButton>
        </div>
      </section>
      <section className="ut-wrap ut-section ut-section-rule">
        <div className="ut-section-heading">
          <p className="ut-eyebrow">What a useful profile should show</p>
          <h2>Performance with its context.</h2>
        </div>
        <div className="ut-feature-grid">
          <article className="ut-feature">
            <span className="ut-step-number">01</span>
            <h3>Identity & scope</h3>
            <p>
              A supported display name, identity asset and sports coverage. No
              unverified expertise or credentials.
            </p>
          </article>
          <article className="ut-feature">
            <span className="ut-step-number">02</span>
            <h3>A complete sample</h3>
            <p>
              Settled picks, outcomes, net units and ROI where supported, with a
              sample size and measurement window. Losses count too.
            </p>
          </article>
          <article className="ut-feature">
            <span className="ut-step-number">03</span>
            <h3>Recent history</h3>
            <p>
              Recent settled official picks and disclosed corrections. No
              hand-picked streaks or testimonials in place of evidence.
            </p>
          </article>
        </div>
      </section>
      <section className="ut-wrap ut-section ut-section-rule">
        <div className="ut-split">
          <div>
            <p className="ut-eyebrow">The VIP promise</p>
            <h2 className="ut-subheading mt-3">Every official capper pick.</h2>
          </div>
          <div>
            <p className="ut-text-secondary leading-relaxed">
              VIP is the complete official-pick membership. VIP+ adds advanced
              intelligence and personalization when available; it is not
              required to complete the official paid pick feed.
            </p>
            <div className="ut-actions mt-6">
              <CTAButton href="/pricing">Explore membership</CTAButton>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
