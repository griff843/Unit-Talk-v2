import type { Metadata } from 'next';
import Link from 'next/link';
import { CTAButton } from '@/components/CTAButton';
import { FAQAccordion, type FAQItem } from '@/components/FAQAccordion';
import { PageHeader } from '@/components/PageHeader';
import { ResponsiblePlayBanner } from '@/components/ResponsiblePlayBanner';
import { PAGE_TITLES } from '@/lib/site-config';

const description =
  'Answers to common questions about Unit Talk: what it is, what members get, how Discord access works, and why it is not a sportsbook.';

export const metadata: Metadata = {
  title: { absolute: PAGE_TITLES.faq },
  description,
  openGraph: { title: PAGE_TITLES.faq, description, type: 'website', siteName: 'Unit Talk' },
  twitter: { card: 'summary', title: PAGE_TITLES.faq, description },
};

const FAQ_ITEMS: FAQItem[] = [
  {
    question: 'What is Unit Talk?',
    answer:
      'Unit Talk is a premium sports betting intelligence product delivered through Discord. Members get structured expert picks, market context, alerts, and a serious community — built around transparency and responsible betting.',
  },
  {
    question: 'Is Unit Talk a sportsbook?',
    answer:
      'No. Unit Talk does not accept wagers, hold funds, or offer betting markets. It is an information, education, and community product.',
  },
  {
    question: 'Do you place bets for members?',
    answer:
      'No. Unit Talk never places bets on anyone’s behalf. Every betting decision — whether, where, and how much — belongs entirely to the member.',
  },
  {
    question: 'Do you guarantee wins?',
    answer:
      'No — explicitly not. Sports betting involves risk and no outcome is ever certain. Any service that promises wins is misleading you. Unit Talk provides structured information and context, never promises.',
  },
  {
    question: 'What do members get?',
    answer:
      'Depending on tier: structured expert capper picks, market context on every pick, Discord alerts, Best Bet previews, results tracking as it rolls out, and members-only discussion channels.',
  },
  {
    question: 'What is VIP?',
    answer:
      'VIP is the core paid tier: structured expert picks with market context, pick alerts in Discord, and members-only channels.',
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
    question: 'How does Discord access work?',
    answer:
      'After joining, you connect your Discord account and the channels for your access level unlock automatically. Discord is where picks, alerts, discussion, and support all live.',
  },
  {
    question: 'Can I cancel?',
    answer:
      'Yes. Memberships are designed to be cancelable at any time, with access continuing through the end of the paid period. Full billing terms will be published before launch.',
  },
  {
    question: 'Do you track results?',
    answer: (
      <>
        Yes — every published pick is tracked internally with its price and outcome. Public results
        will only be released after review and approval. See the{' '}
        <Link href="/results" className="text-[var(--ut-accent)] hover:underline">
          transparency page
        </Link>{' '}
        for the full commitment.
      </>
    ),
  },
  {
    question: 'Is betting risky?',
    answer: (
      <>
        Yes — honestly, it is. Most bettors lose money over time, and even disciplined bettors go
        through losing stretches. Only wager what you can afford to lose, and read our{' '}
        <Link href="/responsible-play" className="text-[var(--ut-accent)] hover:underline">
          responsible play commitment
        </Link>
        .
      </>
    ),
  },
  {
    question: 'Where do I get support?',
    answer: (
      <>
        Support is handled through the dedicated channels in Discord. See the{' '}
        <Link href="/contact" className="text-[var(--ut-accent)] hover:underline">
          contact page
        </Link>{' '}
        for details.
      </>
    ),
  },
];

export default function FAQPage() {
  return (
    <>
      <PageHeader
        title="Frequently asked questions"
        lead="Straight answers about what Unit Talk is — and what it is not."
      />
      <section className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
        <FAQAccordion items={FAQ_ITEMS} />
      </section>
      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <ResponsiblePlayBanner />
      </section>
      <section className="mx-auto max-w-3xl px-4 pb-20 text-center sm:px-6">
        <CTAButton href="/pricing">Get Access</CTAButton>
      </section>
    </>
  );
}
