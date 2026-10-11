import { pageMetadata } from '@/lib/site-metadata';
import type { Metadata } from 'next';
import { CTAButton } from '@/components/CTAButton';
import { PageHeader } from '@/components/PageHeader';
import { ResultsAvailability } from '@/components/ResultsAvailability';
import { ResponsiblePlayBanner } from '@/components/ResponsiblePlayBanner';
import { PAGE_TITLES } from '@/lib/site-config';
const description =
  'The complete settled official-pick record: wins, losses, pushes, voids and correction history. No public results feed is connected yet; no performance figures are displayed.';
export const metadata: Metadata = pageMetadata(
  PAGE_TITLES.results,
  description,
  '/results',
);
export default function ResultsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Results & transparency"
        title="We keep the losses too."
        lead="Every settled official pick belongs in the record. Wins, losses, pushes, voids and corrections all stay visible. The complete settled history belongs across every membership."
      />
      <section className="ut-wrap ut-section pt-0">
        <h2 className="sr-only">Public results availability</h2>
        <ResultsAvailability />
      </section>
      <section className="ut-wrap ut-section ut-section-rule">
        <div className="ut-section-heading">
          <p className="ut-eyebrow">A record you can evaluate</p>
          <h2>Context before claims.</h2>
        </div>
        <div className="ut-feature-grid">
          <article className="ut-feature">
            <span className="ut-step-number">01</span>
            <h3>Every outcome</h3>
            <p>
              Losses are never hidden by default to make performance look
              better. Every settled official pick is included, with its capper,
              sport, event, market, selection, recorded odds and outcome.
            </p>
          </article>
          <article className="ut-feature">
            <span className="ut-step-number">02</span>
            <h3>Measurable performance</h3>
            <p>
              Records, units and ROI need a settled sample and a date range.
              Missing metrics remain unavailable. CLV is shown only when
              supported by recorded closing-line evidence.
            </p>
          </article>
          <article className="ut-feature">
            <span className="ut-step-number">03</span>
            <h3>History stays intact</h3>
            <p>
              Corrections disclose what changed and preserve the original result
              and history. Simulations and backtests are kept separate from live
              results.
            </p>
          </article>
        </div>
      </section>
      <section className="ut-wrap ut-section ut-section-rule">
        <div className="ut-split">
          <div>
            <p className="ut-eyebrow">Free includes the settled record</p>
            <h2 className="ut-subheading mt-3">
              Inspect first. Decide for yourself.
            </h2>
          </div>
          <div>
            <p className="ut-text-secondary leading-relaxed">
              Free includes settled official picks, recaps and corrections. It
              does not include active paid official picks before settlement or
              premium real-time alerts. Membership never guarantees a winning
              result.
            </p>
            <div className="ut-actions mt-6">
              <CTAButton href="/pricing">Explore membership</CTAButton>
              <CTAButton href="/cappers" variant="secondary">
                About the capper record
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
