import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { PAGE_TITLES } from '@/lib/site-config';

const description =
  'Unit Talk’s responsible play commitment: betting involves risk, only wager what you can afford to lose, and seek help if betting stops being entertainment.';

export const metadata: Metadata = {
  title: { absolute: PAGE_TITLES.responsiblePlay },
  description,
  openGraph: { title: PAGE_TITLES.responsiblePlay, description, type: 'website', siteName: 'Unit Talk' },
  twitter: { card: 'summary', title: PAGE_TITLES.responsiblePlay, description },
};

const PRINCIPLES = [
  {
    title: 'Betting involves real risk',
    body: 'Sports betting can result in losing money — sometimes quickly. Most bettors lose over time, and even disciplined bettors go through losing stretches. Acknowledge that risk before every wager.',
  },
  {
    title: 'Unit Talk is information and entertainment',
    body: 'Unit Talk provides picks, context, and community. It is not financial advice, and nothing on this site or in the Discord should be treated as a promise of outcomes.',
  },
  {
    title: 'No one can promise you profit',
    body: 'There is no system, tier, or expert that removes risk from betting. Unit Talk will never claim otherwise, and you should be skeptical of anyone who does.',
  },
  {
    title: 'Only bet what you can afford to lose',
    body: 'Set a budget that would not affect your rent, bills, savings, or family if it disappeared entirely. Never bet money you need.',
  },
  {
    title: 'Be of legal wagering age',
    body: 'You must meet the legal wagering age in your jurisdiction, and betting must be legal where you live, before placing any wager.',
  },
  {
    title: 'Do not chase losses',
    body: 'Increasing your stakes to win back losses is one of the most damaging patterns in betting. If you feel the urge to chase, stop for the day.',
  },
  {
    title: 'Take breaks',
    body: 'Step away regularly. If betting stops feeling like entertainment and starts feeling like a need, that is the signal to pause.',
  },
  {
    title: 'Seek help if betting becomes harmful',
    body: 'If betting is affecting your finances, relationships, work, or mental health, reach out for help. Talking to someone is a strength, not a failure.',
  },
];

export default function ResponsiblePlayPage() {
  return (
    <>
      <PageHeader
        title="Responsible play"
        lead="Unit Talk is built for people who treat betting as disciplined entertainment. This commitment applies to every member, every tier, every day."
      />

      <section className="mx-auto max-w-3xl space-y-5 px-4 pb-16 sm:px-6">
        {PRINCIPLES.map((principle) => (
          <div key={principle.title} className="ut-surface p-6">
            <h2 className="text-base font-semibold">{principle.title}</h2>
            <p className="ut-text-secondary mt-2 text-sm leading-relaxed">{principle.body}</p>
          </div>
        ))}

        <div className="ut-surface border-[var(--ut-warning)]/40 p-6">
          <h2 className="text-base font-semibold">Help resources</h2>
          {/* TODO(responsible-play-resources): add vetted, jurisdiction-specific help resources before launch. */}
          <p className="ut-text-secondary mt-2 text-sm leading-relaxed">
            Jurisdiction-specific resources will be listed here. If you are concerned about your
            betting today, contact a local problem-gambling support service in your area.
          </p>
        </div>

        <p className="ut-text-muted text-xs leading-relaxed">
          This page is informational only. Unit Talk does not provide medical, legal, or financial
          advice.
        </p>
      </section>
    </>
  );
}
