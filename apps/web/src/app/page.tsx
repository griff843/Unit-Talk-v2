import { pageMetadata } from '@/lib/site-metadata';
import type { Metadata } from 'next';
import Link from 'next/link';
import { BrandLogo } from '@/components/BrandLogo';
import { CTAButton } from '@/components/CTAButton';
import { DiscordPreview } from '@/components/DiscordPreview';
import { FAQAccordion } from '@/components/FAQAccordion';
import { PlanCard } from '@/components/PlanCard';
import { ResultsAvailability } from '@/components/ResultsAvailability';
import { ResponsiblePlayBanner } from '@/components/ResponsiblePlayBanner';
import { BRAND, PAGE_TITLES, TIERS } from '@/lib/site-config';
import { FAQ_ITEMS } from '@/lib/faq';
export const metadata: Metadata = pageMetadata(
  PAGE_TITLES.home,
  BRAND.description,
  '/',
);

export default function HomePage() {
  return (
    <>
      <section className="ut-hero">
        <div className="ut-wrap ut-hero-layout">
          <div>
            <p className="ut-eyebrow">Sports betting intelligence</p>
            <h1>
              <span>Official capper picks.</span>
              <span>Every settled result.</span>
              <span className="ut-gold">No cherry-picking.</span>
            </h1>
            <p className="ut-hero-lead">
              Official picks through Discord. A complete settled record for
              every membership. Evaluate the performance for yourself.
            </p>
            <div className="ut-actions">
              <CTAButton href="/pricing">
                Explore membership <span aria-hidden="true">↗</span>
              </CTAButton>
              <CTAButton href="/results" variant="secondary">
                Results & transparency
              </CTAButton>
            </div>
            <p className="ut-text-muted mt-5 max-w-lg text-xs">
              Website checkout and the public results archive are currently
              unavailable.
            </p>
          </div>
          <aside
            className="ut-record-panel"
            aria-label="The Unit Talk commitment"
          >
            <BrandLogo compact className="ut-brand-mark" />
            <p className="ut-eyebrow">The whole picture</p>
            <h2 className="mt-3 text-2xl">The pick is only half the story.</h2>
            <p className="ut-text-secondary mb-7 mt-3 text-sm">
              The outcome matters too. Our transparency policy keeps the
              complete settled record open to every tier.
            </p>
            <div className="ut-record-line">
              <strong>Official picks</strong>
              <span>Trial & VIP entitlement</span>
            </div>
            <div className="ut-record-line">
              <strong>Settled results</strong>
              <span>All memberships</span>
            </div>
            <div className="ut-record-line">
              <strong>Corrections</strong>
              <span>History preserved</span>
            </div>
            <Link href="/results" className="ut-link mt-6 inline-block text-sm">
              Read the transparency policy <span aria-hidden="true">→</span>
            </Link>
          </aside>
        </div>
      </section>
      <ul className="ut-wrap ut-trust-strip" aria-label="Our principles">
        {[
          'Complete settled history',
          'Losses stay visible',
          'Discord at the center',
          'Responsible play',
        ].map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
      <section className="ut-rule">
        <div className="ut-wrap ut-section ut-split">
          <div>
            <p className="ut-eyebrow">01 / Results & transparency</p>
            <h2 className="ut-display mt-5">
              We keep the
              <br />
              losses too.
            </h2>
            <p className="ut-text-secondary mt-6">
              Every settled official pick belongs in the record. Wins, losses,
              pushes, voids and corrections. Free members get the same settled
              history as paid members.
            </p>
            <p className="ut-text-secondary mt-4 text-sm">
              Corrections preserve the original result. Missing metrics stay
              unavailable. Simulations and backtests are never presented as live
              results.
            </p>
            <div className="ut-actions">
              <CTAButton href="/results" variant="secondary">
                Explore the results policy
              </CTAButton>
            </div>
          </div>
          <ResultsAvailability />
        </div>
      </section>
      <section className="ut-rule bg-[var(--ut-bg-surface)]">
        <div className="ut-wrap ut-section">
          <p className="ut-eyebrow">02 / What VIP means</p>
          <h2 className="ut-display mt-5 max-w-3xl">
            Every official capper pick.
            <br />
            One complete membership.
          </h2>
          <div className="ut-feature-grid">
            {[
              [
                '01',
                'The official pick feed',
                'VIP includes every pick designated for the official paid feed across supported sports. The $1 Trial includes the same VIP experience for seven consecutive days.',
              ],
              [
                '02',
                'The people behind the picks',
                'Capper Corner, private community, education and support are part of VIP. Advanced VIP+ tools add to the membership.',
              ],
              [
                '03',
                'The settled record',
                'Complete recaps and results belong across tiers. Supported performance breakdowns give each record its sample size, measurement window and limitations.',
              ],
            ].map(([number, title, body]) => (
              <div key={title} className="ut-feature">
                <span className="ut-num text-xs text-[var(--ut-signal)]">
                  {number}
                </span>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
          <p className="ut-text-muted mt-8 max-w-3xl text-xs">
            These are membership entitlements. Website checkout is unavailable,
            and current member access and real-time alert availability are not
            confirmed here.
          </p>
        </div>
      </section>
      <section>
        <div className="ut-wrap ut-section ut-split">
          <div>
            <p className="ut-eyebrow">03 / Cappers</p>
            <h2 className="ut-display mt-5">
              Evaluate the record.
              <br />
              Know the capper.
            </h2>
            <p className="ut-text-secondary mt-6">
              Capper performance should be traceable to settled official picks,
              with the sample and date range beside the record.
            </p>
            <div className="ut-actions">
              <CTAButton href="/cappers" variant="secondary">
                Explore cappers
              </CTAButton>
            </div>
          </div>
          <div className="ut-availability">
            <span className="ut-tag">Profiles unavailable</span>
            <h3>Facts before reputation.</h3>
            <p>
              Public capper profiles and settled performance are unavailable on
              this website. A useful record needs its sample size and
              measurement window.
            </p>
            <p className="text-xs">
              Read how capper identity and settled history fit together.
            </p>
          </div>
        </div>
      </section>
      <section className="ut-wrap pb-16">
        <div className="ut-discord">
          <div>
            <p className="ut-eyebrow">04 / Discord</p>
            <h2 className="ut-display mt-5">
              Where the sport
              <br />
              becomes a conversation.
            </h2>
            <p className="ut-text-secondary mt-6">
              Discord is the primary member delivery and community surface:
              official picks, recaps, education and discussion appropriate to
              your membership.
            </p>
            <div className="ut-actions">
              <CTAButton href="/how-it-works" variant="secondary">
                See the member journey
              </CTAButton>
            </div>
          </div>
          <DiscordPreview />
        </div>
      </section>
      <section className="ut-rule">
        <div className="ut-wrap ut-section">
          <div className="mb-10 flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <p className="ut-eyebrow">05 / Membership</p>
              <h2 className="ut-display mt-5">
                Start with trust.
                <br />
                Choose your access.
              </h2>
            </div>
            <Link href="/pricing" className="ut-link text-sm">
              Compare all memberships <span aria-hidden="true">↗</span>
            </Link>
          </div>
          <div
            role="list"
            className="ut-progression"
            aria-label="Membership progression"
          >
            {TIERS.map((tier, index) => (
              <span role="listitem" key={tier.id}>
                {index ? <b aria-hidden="true">→ </b> : null}
                {tier.name}
              </span>
            ))}
          </div>
          <div className="ut-membership-grid">
            {TIERS.slice(0, 3).map((tier) => (
              <PlanCard key={tier.id} tier={tier} />
            ))}
          </div>
          <p className="ut-text-muted mt-6 text-sm">
            VIP+: price not published; availability unconfirmed. Black Label:
            future tier — not currently available.
          </p>
        </div>
      </section>
      <section className="ut-rule">
        <div className="ut-wrap ut-section ut-split">
          <div>
            <p className="ut-eyebrow">06 / How it works</p>
            <h2 className="ut-display mt-5">
              Your membership.
              <br />
              Your decisions.
            </h2>
            <p className="ut-text-secondary mt-6">
              Unit Talk provides information and community. Whether to wager,
              where to wager and how much to stake remain your decisions.
            </p>
            <div className="ut-actions">
              <CTAButton href="/how-it-works" variant="secondary">
                Read the walkthrough
              </CTAButton>
            </div>
          </div>
          <ol>
            {[
              [
                'Inspect the record',
                'Understand the complete settled-history policy before choosing paid access.',
              ],
              [
                'Understand membership',
                'Free for settled history and public value. Trial for full VIP. VIP for every official capper pick.',
              ],
              [
                'Connect through Discord',
                'When enrollment is available, follow the published onboarding steps for membership-appropriate access. Automatic role provisioning is not promised here.',
              ],
            ].map(([title, body], index) => (
              <li key={title} className="ut-index-row">
                <span className="ut-index-num">0{index + 1}</span>
                <div>
                  <h3 className="text-lg">{title}</h3>
                  <p className="ut-text-secondary mt-2 text-sm">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <section className="ut-rule">
        <div className="ut-wrap ut-section ut-split">
          <div>
            <p className="ut-eyebrow">07 / Straight answers</p>
            <h2 className="ut-display mt-5">
              Understand before
              <br />
              you join.
            </h2>
            <Link className="ut-link mt-6 inline-block text-sm" href="/faq">
              Read every FAQ <span aria-hidden="true">→</span>
            </Link>
          </div>
          <FAQAccordion
            items={FAQ_ITEMS.filter((item) =>
              ['sportsbook', 'trial', 'every-pick', 'guarantees'].includes(
                item.id,
              ),
            )}
          />
        </div>
      </section>
      <section className="ut-wrap pb-16">
        <ResponsiblePlayBanner />
      </section>
      <section className="ut-rule bg-[var(--ut-bg-surface)]">
        <div className="ut-wrap ut-section text-center">
          <p className="ut-eyebrow">Make an informed choice</p>
          <h2 className="ut-display mt-5">
            The picks. The people.
            <br />
            The complete picture.
          </h2>
          <div className="ut-actions justify-center">
            <CTAButton href="/pricing">Explore membership</CTAButton>
            <CTAButton href="/results" variant="secondary">
              Results & transparency
            </CTAButton>
          </div>
        </div>
      </section>
    </>
  );
}
