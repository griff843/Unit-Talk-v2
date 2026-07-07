import type { Metadata } from 'next';
import { CTAButton } from '@/components/CTAButton';
import { PageHeader } from '@/components/PageHeader';
import { ResponsiblePlayBanner } from '@/components/ResponsiblePlayBanner';
import { SectionHeader } from '@/components/SectionHeader';
import { PAGE_TITLES } from '@/lib/site-config';

const description =
  'How Unit Talk works: join, connect to Discord, choose an access level, and receive structured picks, market context, and alerts — with transparency and responsible betting built in.';

export const metadata: Metadata = {
  title: { absolute: PAGE_TITLES.howItWorks },
  description,
  openGraph: { title: PAGE_TITLES.howItWorks, description, type: 'website', siteName: 'Unit Talk' },
  twitter: { card: 'summary', title: PAGE_TITLES.howItWorks, description },
};

const STEPS = [
  {
    title: 'Join Unit Talk',
    body: 'Create your membership. You can start on the free tier and upgrade at any time.',
  },
  {
    title: 'Connect Discord',
    body: 'Link your Discord account. Your channels unlock based on your access level.',
  },
  {
    title: 'Pick your access level',
    body: 'Free for the public channels, VIP for structured picks, VIP+ for the full premium experience.',
  },
  {
    title: 'Get alerts and context',
    body: 'Structured picks arrive as Discord alerts with market context attached, so you understand each one.',
  },
  {
    title: 'Track results and transparency updates',
    body: 'Unit Talk tracks its picks internally and publishes transparency updates as they are reviewed and approved.',
  },
  {
    title: 'Bet responsibly',
    body: 'Every decision is yours. Set limits, only wager what you can afford to lose, and take breaks.',
  },
];

const SECTIONS = [
  {
    title: 'Discord access',
    body: 'Discord is where the product lives — delivery, discussion, education, and support. Once your account is connected, the channels for your tier open automatically. There is nothing to install beyond Discord itself.',
  },
  {
    title: 'Pick alerts',
    body: 'When a pick is published, members receive a structured alert: the selection, the market, the price context, and the reasoning. Alerts are designed to be readable in seconds and clear enough to act on your own terms.',
  },
  {
    title: 'Market context',
    body: 'A pick without context is just a shout. Every Unit Talk pick includes notes on price and line so members understand why the spot was selected — not just what to bet.',
  },
  {
    title: 'Tier differences',
    body: 'Free members follow along in public channels. VIP unlocks structured picks and alerts. VIP+ adds Best Bet previews, priority delivery, and expanded analysis. Syndicate, a future top tier, will be announced closer to launch.',
  },
  {
    title: 'Education and community',
    body: 'Unit Talk is also a place to get sharper: discussion channels, process-focused education, and a community of members who take the craft seriously.',
  },
  {
    title: 'Responsible betting',
    body: 'Responsible betting comes first. Unit Talk is an information and entertainment product — it never promises outcomes, and it actively encourages limits, breaks, and honest self-assessment.',
  },
  {
    title: 'Support',
    body: 'Questions and account issues are handled through the support channels in Discord. The team monitors them and responds as quickly as possible.',
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <PageHeader
        title="How Unit Talk works"
        lead="From joining to your first structured alert — here is the full walkthrough."
      />

      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="ut-surface p-6">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--ut-accent)] text-sm font-bold text-white">
                {i + 1}
              </span>
              <h2 className="mt-4 text-base font-semibold">{step.title}</h2>
              <p className="ut-text-secondary mt-2 text-sm leading-relaxed">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t border-[var(--ut-border-subtle)] bg-[var(--ut-bg-surface)]">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <SectionHeader title="The details" />
          <div className="mt-10 space-y-5">
            {SECTIONS.map((section) => (
              <div key={section.title} className="ut-surface-elevated p-6">
                <h2 className="text-base font-semibold">{section.title}</h2>
                <p className="ut-text-secondary mt-2 text-sm leading-relaxed">{section.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <ResponsiblePlayBanner />
        <div className="mt-10 text-center">
          <CTAButton href="/pricing">Get Access</CTAButton>
        </div>
      </section>
    </>
  );
}
