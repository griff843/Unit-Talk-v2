import type { Metadata } from 'next';
import { CTAButton } from '@/components/CTAButton';
import { FAQAccordion } from '@/components/FAQAccordion';
import { PageHeader } from '@/components/PageHeader';
import { PlanCard } from '@/components/PlanCard';
import { PricingTable } from '@/components/PricingTable';
import { ResponsiblePlayBanner } from '@/components/ResponsiblePlayBanner';
import { SectionHeader } from '@/components/SectionHeader';
import { PAGE_TITLES, TIERS } from '@/lib/site-config';

const description =
  'Compare Unit Talk membership tiers — Free, VIP, VIP+, and the upcoming Syndicate tier. Structured picks, market context, and premium Discord access. Pricing is not yet finalized.';

export const metadata: Metadata = {
  title: { absolute: PAGE_TITLES.pricing },
  description,
  openGraph: { title: PAGE_TITLES.pricing, description, type: 'website', siteName: 'Unit Talk' },
  twitter: { card: 'summary', title: PAGE_TITLES.pricing, description },
};

const PRICING_FAQ = [
  {
    question: 'What do I get as a member?',
    answer:
      'Depending on your tier: structured expert picks, market context, alerts, Best Bet previews, results tracking as it rolls out, and access to a premium Discord community.',
  },
  {
    question: 'What is VIP?',
    answer:
      'VIP is the core paid tier: structured expert capper picks with market context, pick alerts in Discord, and members-only discussion channels.',
  },
  {
    question: 'What is VIP+?',
    answer:
      'VIP+ is the full premium experience: everything in VIP plus Best Bet previews, priority alert delivery, and expanded analysis.',
  },
  {
    question: 'What is Syndicate?',
    answer:
      'Syndicate is a future top tier built around the deepest level of picks intelligence Unit Talk produces. Details will be announced closer to launch.',
  },
  {
    question: 'Is this a sportsbook?',
    answer:
      'No. Unit Talk does not accept or place wagers. It is an information, education, and community product delivered through Discord.',
  },
  {
    question: 'Do you guarantee wins?',
    answer:
      'No. Sports betting involves risk and no service can promise outcomes. Unit Talk provides structured information and context — never guarantees.',
  },
  {
    question: 'Can I cancel?',
    answer:
      'Yes. Memberships are designed to be cancelable at any time; access continues through the end of the paid period. Full billing terms will be published before launch.',
  },
  {
    question: 'How do I access Discord?',
    answer:
      'After joining, you connect your Discord account and the channels for your tier unlock automatically. Support is available in Discord if anything goes wrong.',
  },
];

export default function PricingPage() {
  return (
    <>
      <PageHeader
        eyebrow="Access levels"
        title="Membership tiers"
        lead="Start free, upgrade when you're ready. Every tier is built around the same principle: structured information and a transparent process. Final pricing has not yet been set — see below."
      />

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {TIERS.map((tier) => (
            <PlanCard key={tier.id} tier={tier} />
          ))}
        </div>
        <p className="ut-text-muted mx-auto mt-6 max-w-2xl text-center text-xs leading-relaxed">
          Pricing shown above is a placeholder. Final membership pricing, billing cadence, and any
          launch offers are pending PM decision and will be published here before checkout goes
          live.
        </p>
      </section>

      <section className="border-t border-[var(--ut-border-subtle)] bg-[var(--ut-bg-surface)]">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <SectionHeader eyebrow="Compare" title="Feature by tier" />
          <div className="mt-8">
            <PricingTable />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <SectionHeader eyebrow="FAQ" title="Pricing questions" />
        <div className="mt-8">
          <FAQAccordion items={PRICING_FAQ} />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <ResponsiblePlayBanner />
      </section>

      <section className="ut-grid-texture border-t border-[var(--ut-border-subtle)] px-4 py-20 text-center sm:px-6">
        <h2 className="text-2xl font-bold tracking-tight">Join Unit Talk</h2>
        <p className="ut-text-secondary mx-auto mt-3 max-w-md text-sm leading-relaxed">
          Pick your access level and connect to the desk.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <CTAButton href="/contact">Get Access</CTAButton>
          <CTAButton href="/how-it-works" variant="secondary">
            See How It Works
          </CTAButton>
        </div>
      </section>
    </>
  );
}
