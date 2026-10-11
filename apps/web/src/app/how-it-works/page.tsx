import { pageMetadata } from '@/lib/site-metadata';
import type { Metadata } from 'next';
import { CTAButton } from '@/components/CTAButton';
import { DiscordPreview } from '@/components/DiscordPreview';
import { PageHeader } from '@/components/PageHeader';
import { ResponsiblePlayBanner } from '@/components/ResponsiblePlayBanner';
import { PAGE_TITLES } from '@/lib/site-config';
const description =
  'Understand Unit Talk membership, the official capper-pick feed, Discord delivery and complete settled results. Public checkout and onboarding are unavailable here.';
export const metadata: Metadata = pageMetadata(
  PAGE_TITLES.howItWorks,
  description,
  '/how-it-works',
);
const steps = [
  [
    'Inspect the record',
    'Start with the complete settled history. Free includes every settled official pick, recap and correction. The public archive is not connected to this site yet.',
  ],
  [
    'Choose your membership',
    'The $1 Trial includes seven consecutive days of full VIP. VIP is $49.99/month and includes every official capper pick. Website checkout is unavailable.',
  ],
  [
    'Connect Discord',
    'Discord is the primary member delivery and community surface. A public onboarding link is unavailable here. Existing members should use their established Discord access.',
  ],
  [
    'Receive membership access',
    'Trial and VIP include the official-pick feed, Capper Corner, private community, recaps, education and support. Official-pick alerts depend on active delivery; automatic role or channel provisioning is not promised here.',
  ],
  [
    'Review every settled result',
    'Wins, losses, pushes, voids and correction history belong across all tiers. Supported metrics need a date range and sample size. Missing metrics stay unavailable.',
  ],
  [
    'Upgrade when it adds value',
    'VIP+ adds advanced capabilities only when their availability is proven. Its price is not published. Black Label is a future tier and is not currently available.',
  ],
];
export default function HowItWorksPage() {
  return (
    <>
      <PageHeader
        eyebrow="How it works"
        title="The picks in Discord. The record in full."
        lead="Understand the product before choosing a membership. You decide whether to wager; Unit Talk does not accept or place bets."
      />
      <section className="ut-wrap ut-section pt-0">
        <div className="ut-notice">
          <span className="ut-status-dot" aria-hidden="true" />
          <p>
            This describes the membership journey. Public checkout, Discord
            onboarding and the results archive are unavailable on this website.
          </p>
        </div>
        <ol className="ut-journey mt-8">
          {steps.map(([title, copy], index) => (
            <li key={title}>
              <span className="ut-step-number" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div>
                <h2>{title}</h2>
                <p>{copy}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section className="ut-wrap ut-section ut-section-rule">
        <div className="ut-split">
          <div className="ut-section-heading">
            <p className="ut-eyebrow">Discord is central</p>
            <h2>A place for picks, context and community.</h2>
            <p className="ut-text-secondary">
              The official-pick feed and member conversations live in Discord.
              Settled recaps and the complete history let members review
              outcomes for themselves.
            </p>
            <div className="ut-actions mt-6">
              <CTAButton href="/pricing">Explore membership</CTAButton>
              <CTAButton href="/contact" variant="secondary">
                Support information
              </CTAButton>
            </div>
          </div>
          <DiscordPreview />
        </div>
      </section>
      <section className="ut-wrap pb-16">
        <ResponsiblePlayBanner />
      </section>
    </>
  );
}
