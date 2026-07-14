import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { PAGE_TITLES, RESPONSIBLE_GAMBLING_RESOURCES } from '@/lib/site-config';

const description =
  "Unit Talk's responsible play commitment: betting involves risk, only wager what you can afford to lose, and seek help if betting stops being entertainment.";

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
        eyebrow="Commitment"
        title="Responsible play"
        lead="Unit Talk is built for people who treat betting as disciplined entertainment. This commitment applies to every member, every tier, every day."
      />

      <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        {PRINCIPLES.map((principle, i) => (
          <div key={principle.title} className="ut-index-row">
            <span className="ut-index-num">{String(i + 1).padStart(2, '0')}</span>
            <div>
              <h2 className="text-base font-semibold">{principle.title}</h2>
              <p className="ut-text-secondary mt-2 max-w-xl text-sm leading-relaxed">{principle.body}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="border-t border-[var(--ut-border-subtle)] bg-[var(--ut-bg-surface)]">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <div className="ut-panel ut-notch border-l-2 border-l-[var(--ut-signal)] p-6">
            <p className="ut-eyebrow">Help resources</p>
            <p className="ut-text-secondary mt-3 text-sm leading-relaxed">
              If betting is affecting your finances, relationships, work, or mental health, these
              established, independent organizations can help — free and confidential.
            </p>
            <ul className="mt-5 space-y-4">
              {RESPONSIBLE_GAMBLING_RESOURCES.map((resource) => (
                <li key={resource.name} className="border-t border-[var(--ut-border-subtle)] pt-4 first:border-t-0 first:pt-0">
                  <p className="text-sm font-semibold">
                    {resource.href ? (
                      <a href={resource.href} className="ut-link">
                        {resource.name}
                      </a>
                    ) : (
                      resource.name
                    )}
                  </p>
                  <p className="ut-text-secondary mt-1 text-sm leading-relaxed">{resource.detail}</p>
                </li>
              ))}
            </ul>
            {/* TODO(responsible-play-resources): add jurisdiction-specific resources (state helplines, international lines) before launch. */}
            <p className="ut-text-muted mt-5 text-xs leading-relaxed">
              Jurisdiction-specific resources (state and international helplines) will be added
              here before launch. If your region isn&apos;t covered above, search for a local
              problem-gambling support service.
            </p>
          </div>

          <p className="ut-text-muted mt-6 text-xs leading-relaxed">
            This page is informational only. Unit Talk does not provide medical, legal, or
            financial advice.
          </p>
        </div>
      </section>
    </>
  );
}
