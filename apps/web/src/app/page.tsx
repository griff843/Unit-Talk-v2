import type { Metadata } from 'next';
import Link from 'next/link';
import { CTAButton } from '@/components/CTAButton';
import { ComingSoonCard } from '@/components/ComingSoonCard';
import { FAQAccordion } from '@/components/FAQAccordion';
import { PlanCard } from '@/components/PlanCard';
import { ResponsiblePlayBanner } from '@/components/ResponsiblePlayBanner';
import { SectionHeader } from '@/components/SectionHeader';
import { BRAND, PAGE_TITLES, TICKER_ITEMS, TIERS } from '@/lib/site-config';

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

const WHY_ROWS = [
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
    title: 'Discord-native desk',
    body: 'Delivery, discussion, education, and support all live in one premium Discord community built for serious members.',
  },
];

const HOW_STEPS = [
  { step: '01', title: 'Join Unit Talk', body: 'Create your membership and pick a starting point.' },
  { step: '02', title: 'Connect Discord', body: 'Link your account to unlock your channels.' },
  { step: '03', title: 'Choose your level', body: 'Free, VIP, or VIP+ — upgrade whenever you want.' },
  { step: '04', title: 'Receive alerts', body: 'Structured picks and context arrive in your channels.' },
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

function DeskPanel() {
  const rows = [
    { tag: 'NBA', label: 'Signal posted', tone: 'signal' },
    { tag: 'MARKET', label: 'Context attached', tone: 'muted' },
    { tag: 'NFL', label: 'Alert delivered', tone: 'pos' },
    { tag: 'RESULTS', label: 'Tracking · not yet public', tone: 'muted' },
  ] as const;

  return (
    <div className="ut-panel ut-notch ut-grid-texture w-full max-w-md p-5 shadow-2xl shadow-black/50">
      <div className="flex items-center justify-between border-b border-[var(--ut-border-subtle)] pb-3">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="ut-live-dot animate-ut-pulse" />
          <span className="ut-num text-xs font-semibold tracking-wide">#vip-alert-desk</span>
        </div>
        <span className="ut-tag ut-tag-signal">Live desk</span>
      </div>

      <div className="mt-3 divide-y divide-[var(--ut-border-subtle)]">
        {rows.map((row) => (
          <div key={row.tag + row.label} className="flex items-center justify-between py-2.5">
            <span className="ut-num text-[11px] font-semibold text-[var(--ut-text-muted)]">{row.tag}</span>
            <span
              className={`text-xs font-medium ${
                row.tone === 'signal'
                  ? 'text-[var(--ut-signal)]'
                  : row.tone === 'pos'
                    ? 'text-[var(--ut-tick-pos)]'
                    : 'ut-text-secondary'
              }`}
            >
              {row.label}
            </span>
          </div>
        ))}
      </div>

      <p className="ut-text-muted mt-3 border-t border-[var(--ut-border-subtle)] pt-3 text-[10px] leading-relaxed">
        Illustrative preview of the member desk — not live data or a performance claim.
      </p>
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      {/* Hero — asymmetric, not centered */}
      <section className="ut-grid-texture relative overflow-hidden border-b border-[var(--ut-border-subtle)]">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 pb-16 pt-16 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:pt-24">
          <div>
            <p className="ut-eyebrow">Member intelligence desk</p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
              Betting intelligence built for <span className="text-[var(--ut-signal)]">serious action.</span>
            </h1>
            <p className="ut-text-secondary mt-5 max-w-lg text-lg leading-relaxed">
              {BRAND.description}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <CTAButton href="/pricing">Get Access</CTAButton>
              <CTAButton href="/how-it-works" variant="secondary">
                See How It Works
              </CTAButton>
            </div>
          </div>
          <div className="flex justify-center lg:justify-end">
            <DeskPanel />
          </div>
        </div>
      </section>

      {/* Ticker strip */}
      <div className="ut-ticker" aria-label="What Unit Talk stands for">
        <div className="ut-ticker-track animate-ut-ticker">
          {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
            <span key={`${item}-${i}`} className="ut-ticker-item">
              {item}
            </span>
          ))}
        </div>
      </div>

      {/* Why Unit Talk — index rows, not icon cards */}
      <section className="mx-auto max-w-4xl px-4 py-20 sm:px-6">
        <SectionHeader
          eyebrow="Why Unit Talk"
          title="A disciplined product, not a hype machine"
          lead="Unit Talk is built for bettors who want structure, context, and accountability."
        />
        <div className="mt-10">
          {WHY_ROWS.map((row, i) => (
            <div key={row.title} className="ut-index-row">
              <span className="ut-index-num">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <h3 className="text-base font-semibold">{row.title}</h3>
                <p className="ut-text-secondary mt-2 max-w-xl text-sm leading-relaxed">{row.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Product preview — asymmetric bento grid */}
      <section className="border-y border-[var(--ut-border-subtle)] bg-[var(--ut-bg-surface)]">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <SectionHeader eyebrow="What's inside" title="The member desk" align="center" />
          <div className="mx-auto mt-12 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:grid-rows-2">
            <div className="ut-panel ut-notch ut-grid-texture p-6 lg:col-span-2 lg:row-span-2">
              <p className="ut-tag ut-tag-signal">Core</p>
              <h3 className="mt-3 text-lg font-semibold">VIP &amp; VIP+ picks</h3>
              <p className="ut-text-secondary mt-2 text-sm leading-relaxed">
                Structured expert capper picks with market context, delivered as Discord alerts —
                the selection, the price context, and the reasoning attached.
              </p>
            </div>
            {[
              { title: 'Best Bets', body: 'Highlighted VIP+ selections that stand out from the daily slate.' },
              { title: 'Alerts', body: 'Timely Discord pings when picks and updates go live.' },
              { title: 'Results channel', body: 'A dedicated channel for tracked outcomes as they are reviewed.' },
              { title: 'Syndicate', body: 'A future top tier of picks intelligence, coming after launch.' },
            ].map((item) => (
              <div key={item.title} className="ut-panel-elevated p-5">
                <h3 className="text-sm font-semibold">{item.title}</h3>
                <p className="ut-text-secondary mt-2 text-sm leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works — dashed timeline track */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <SectionHeader eyebrow="How it works" title="Up and running in four steps" align="center" />
        <ol className="ut-track mt-16 grid gap-10 md:grid-cols-4 md:gap-6">
          {HOW_STEPS.map((item) => (
            <li key={item.step} className="relative pl-8 md:pl-0">
              <span
                aria-hidden="true"
                className="ut-num absolute left-0 top-0 flex h-[1.9rem] w-[1.9rem] items-center justify-center border border-[var(--ut-signal)] bg-[var(--ut-bg-canvas)] text-xs font-bold text-[var(--ut-signal)] md:relative md:mb-4"
              >
                {item.step}
              </span>
              <h3 className="text-base font-semibold md:mt-0">{item.title}</h3>
              <p className="ut-text-secondary mt-2 text-sm leading-relaxed">{item.body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-12 text-center">
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
            align="center"
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
          eyebrow="Results &amp; transparency"
          title="Accountability is part of the product"
          lead="Unit Talk will not publish performance claims unless the underlying data is tracked, reviewed, and approved for public release."
          align="center"
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
          <SectionHeader eyebrow="FAQ" title="Straight answers" align="center" />
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
      <section className="ut-grid-texture border-t border-[var(--ut-border-subtle)] px-4 py-20 text-center sm:px-6">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Ready for a cleaner betting process?
        </h2>
        <p className="ut-text-secondary mx-auto mt-4 max-w-xl text-base leading-relaxed">
          Join Unit Talk and get structured picks, market context, and a premium Discord desk built
          for serious members.
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
