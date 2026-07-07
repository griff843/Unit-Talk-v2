import type { Metadata } from 'next';
import Link from 'next/link';
import { CTAButton } from '@/components/CTAButton';
import { ComingSoonCard } from '@/components/ComingSoonCard';
import { FAQAccordion } from '@/components/FAQAccordion';
import { PlanCard } from '@/components/PlanCard';
import { ResponsiblePlayBanner } from '@/components/ResponsiblePlayBanner';
import { SectionHeader } from '@/components/SectionHeader';
import { BRAND, PAGE_TITLES, TIERS } from '@/lib/site-config';

export const metadata: Metadata = {
  title: { absolute: PAGE_TITLES.home },
  description: BRAND.description,
  openGraph: {
    title: PAGE_TITLES.home,
    description: BRAND.description,
    type: 'website',
    siteName: BRAND.name,
  },
  twitter: { card: 'summary_large_image', title: PAGE_TITLES.home, description: BRAND.description },
};

const TRUST_ITEMS = [
  'Structured picks',
  'Premium Discord access',
  'Market-aware alerts',
  'Transparent process',
  'Responsible betting first',
];

const WHY_CARDS = [
  {
    title: 'Signal over noise',
    body: 'Every pick is delivered in a structured format with the reasoning and market context attached — not a firehose of untracked calls.',
  },
  {
    title: 'Built around execution',
    body: 'Alerts arrive when they matter, with the details a member needs to act on their own terms and their own timeline.',
  },
  {
    title: 'Transparent by design',
    body: 'Unit Talk tracks its own picks internally and is building a public transparency layer, so accountability is part of the product.',
  },
  {
    title: 'Discord-native experience',
    body: 'Delivery, discussion, education, and support all live in one premium Discord community built for serious members.',
  },
];

const PRODUCT_PREVIEW = [
  { title: 'VIP picks', body: 'Structured expert capper picks delivered to VIP members.' },
  { title: 'VIP+ premium access', body: 'Deeper access, earlier alerts, and expanded analysis.' },
  { title: 'Best Bets', body: 'Highlighted selections that stand out from the daily slate.' },
  { title: 'Market context', body: 'Price and line context so members understand each pick.' },
  { title: 'Alerts', body: 'Timely Discord alerts when picks and updates go live.' },
  { title: 'Results channel', body: 'A dedicated channel for tracked outcomes as they are reviewed.' },
  { title: 'Member discussion', body: 'A serious community of members comparing notes and process.' },
  { title: 'Future Syndicate tier', body: 'A top tier of picks intelligence, coming after launch.' },
];

const HOW_STEPS = [
  { step: '1', title: 'Join Unit Talk', body: 'Create your membership and pick a starting point.' },
  { step: '2', title: 'Connect to Discord', body: 'Link your Discord account to unlock your channels.' },
  { step: '3', title: 'Choose your access level', body: 'Free, VIP, or VIP+ — upgrade whenever you want.' },
  { step: '4', title: 'Receive structured alerts and analysis', body: 'Picks, context, and updates arrive in your member channels.' },
];

const FAQ_TEASER = [
  {
    question: 'Is Unit Talk a sportsbook?',
    answer:
      'No. Unit Talk does not accept or place wagers. It is an information and community product delivered through Discord.',
  },
  {
    question: 'Do you guarantee wins?',
    answer:
      'No. Sports betting involves risk and no outcome is ever certain. Unit Talk provides structured information, not promises.',
  },
  {
    question: 'What do members actually get?',
    answer:
      'Structured expert picks, market context, alerts, results tracking as it rolls out, and access to a premium Discord community.',
  },
];

function HeroIllustration() {
  return (
    <div aria-label="Illustration of the member experience" className="ut-surface w-full max-w-md p-4 shadow-2xl shadow-black/40">
      <div className="flex items-center justify-between border-b border-[var(--ut-border-subtle)] pb-3">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-[var(--ut-success)]" />
          <span className="text-xs font-semibold tracking-wide">#vip-pick-alerts</span>
        </div>
        <div className="flex gap-1.5">
          <span className="ut-badge">VIP</span>
          <span className="ut-badge border-[var(--ut-accent)] text-[var(--ut-accent)]">VIP+</span>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        <div className="ut-surface-elevated p-3">
          <p className="text-xs font-semibold text-[var(--ut-accent)]">VIP Pick Alert</p>
          <p className="mt-1 text-sm font-medium">New structured pick posted</p>
          <p className="ut-text-muted mt-1 text-xs">Sport · Market · Price context · Reasoning attached</p>
        </div>

        <div className="ut-surface-elevated p-3">
          <p className="text-xs font-semibold text-[var(--ut-warning)]">Market Context</p>
          <p className="ut-text-secondary mt-1 text-xs">
            Line and price notes explaining why this spot was selected.
          </p>
        </div>

        <div className="ut-surface-elevated p-3">
          <p className="text-xs font-semibold text-[var(--ut-success)]">Best Bet Preview</p>
          <p className="ut-text-secondary mt-1 text-xs">
            Today&apos;s highlighted selection for VIP+ members.
          </p>
        </div>

        <div className="ut-surface-elevated flex items-center justify-between p-3">
          <p className="text-xs font-semibold">Results Tracking</p>
          <span className="ut-badge">Coming Soon</span>
        </div>
      </div>

      <p className="ut-text-muted mt-3 border-t border-[var(--ut-border-subtle)] pt-3 text-[10px] leading-relaxed">
        Bet responsibly. Only wager what you can afford to lose.
      </p>
      <p className="ut-text-muted mt-1 text-[10px] italic">Illustration of the member experience</p>
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="mx-auto flex max-w-6xl flex-col items-center gap-12 px-4 pb-16 pt-16 sm:px-6 lg:flex-row lg:items-center lg:pt-24">
        <div className="max-w-xl text-center lg:text-left">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Betting intelligence built for serious action.
          </h1>
          <p className="ut-text-secondary mt-5 text-lg leading-relaxed">
            Unit Talk gives members structured picks, market context, alerts, and a premium Discord
            experience designed to help bettors make cleaner decisions.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
            <CTAButton href="/pricing">Get Access</CTAButton>
            <CTAButton href="/how-it-works" variant="secondary">
              See How It Works
            </CTAButton>
          </div>
        </div>
        <div className="flex w-full justify-center lg:justify-end">
          <HeroIllustration />
        </div>
      </section>

      {/* Trust strip */}
      <section aria-label="What Unit Talk stands for" className="border-y border-[var(--ut-border-subtle)] bg-[var(--ut-bg-surface)]">
        <ul className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-2 px-4 py-5 sm:px-6">
          {TRUST_ITEMS.map((item) => (
            <li key={item} className="ut-text-secondary text-sm font-medium">
              {item}
            </li>
          ))}
        </ul>
      </section>

      {/* Why Unit Talk */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <SectionHeader
          eyebrow="Why Unit Talk"
          title="A disciplined product, not a hype machine"
          lead="Unit Talk is built for bettors who want structure, context, and accountability."
        />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {WHY_CARDS.map((card) => (
            <div key={card.title} className="ut-surface p-6">
              <h3 className="text-base font-semibold">{card.title}</h3>
              <p className="ut-text-secondary mt-3 text-sm leading-relaxed">{card.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Product preview */}
      <section className="border-y border-[var(--ut-border-subtle)] bg-[var(--ut-bg-surface)]">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <SectionHeader
            eyebrow="What's inside"
            title="The member experience"
            lead="Everything is delivered through a premium Discord built around clarity and process."
          />
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {PRODUCT_PREVIEW.map((item) => (
              <div key={item.title} className="ut-surface-elevated p-5">
                <h3 className="text-sm font-semibold">{item.title}</h3>
                <p className="ut-text-secondary mt-2 text-sm leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <SectionHeader eyebrow="How it works" title="Up and running in four steps" />
        <ol className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {HOW_STEPS.map((item) => (
            <li key={item.step} className="ut-surface p-6">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--ut-accent)] text-sm font-bold text-white">
                {item.step}
              </span>
              <h3 className="mt-4 text-base font-semibold">{item.title}</h3>
              <p className="ut-text-secondary mt-2 text-sm leading-relaxed">{item.body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-10 text-center">
          <CTAButton href="/how-it-works" variant="secondary">
            See the full walkthrough
          </CTAButton>
        </div>
      </section>

      {/* Pricing preview */}
      <section className="border-y border-[var(--ut-border-subtle)] bg-[var(--ut-bg-surface)]">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <SectionHeader
            eyebrow="Access levels"
            title="Choose how deep you want to go"
            lead="Start free, upgrade when you're ready. Syndicate arrives after launch."
          />
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {TIERS.map((tier) => (
              <PlanCard key={tier.id} tier={tier} />
            ))}
          </div>
          <div className="mt-10 text-center">
            <CTAButton href="/pricing">Compare all tiers</CTAButton>
          </div>
        </div>
      </section>

      {/* Results / transparency preview */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <SectionHeader
          eyebrow="Results & transparency"
          title="Accountability is part of the product"
          lead="Unit Talk will not publish performance claims unless the underlying data is tracked, reviewed, and approved for public release."
        />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <ComingSoonCard title="Pick Archive" description="A reviewable archive of published picks and their recorded details." />
          <ComingSoonCard title="Verified Results" description="Outcomes published only after internal tracking and review." />
          <ComingSoonCard title="Methodology Report" description="How picks are produced, tracked, and evaluated." />
          <ComingSoonCard title="Transparency Dashboard" description="A public view into what Unit Talk tracks and releases." />
        </div>
        <div className="mt-10 text-center">
          <Link href="/results" className="ut-link text-sm font-medium">
            Read the full transparency commitment →
          </Link>
        </div>
      </section>

      {/* Responsible betting banner */}
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <ResponsiblePlayBanner />
      </section>

      {/* FAQ teaser */}
      <section className="border-t border-[var(--ut-border-subtle)] bg-[var(--ut-bg-surface)]">
        <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
          <SectionHeader eyebrow="FAQ" title="Straight answers" />
          <div className="mt-10">
            <FAQAccordion items={FAQ_TEASER} />
          </div>
          <div className="mt-8 text-center">
            <Link href="/faq" className="ut-link text-sm font-medium">
              See all FAQs →
            </Link>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Ready for a cleaner betting process?
        </h2>
        <p className="ut-text-secondary mt-4 text-base leading-relaxed">
          Join Unit Talk and get structured picks, market context, and a premium Discord community
          built for serious members.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <CTAButton href="/pricing">Get Access</CTAButton>
          <CTAButton href="/faq" variant="secondary">
            Read the FAQ
          </CTAButton>
        </div>
      </section>
    </>
  );
}
