import type { Metadata } from 'next';
import { ComingSoonCard } from '@/components/ComingSoonCard';
import { PageHeader } from '@/components/PageHeader';
import { ResponsiblePlayBanner } from '@/components/ResponsiblePlayBanner';
import { SectionHeader } from '@/components/SectionHeader';
import { PAGE_TITLES } from '@/lib/site-config';

const description =
  'Unit Talk treats transparency as part of the product. Picks, prices, and outcomes are tracked internally; public results will only display metrics that are properly reviewed and approved.';

export const metadata: Metadata = {
  title: { absolute: PAGE_TITLES.results },
  description,
  openGraph: { title: PAGE_TITLES.results, description, type: 'website', siteName: 'Unit Talk' },
  twitter: { card: 'summary', title: PAGE_TITLES.results, description },
};

const COMMITMENTS = [
  {
    title: 'Transparency is part of the product',
    body: 'Most pick services show you their best week and hide the rest. Unit Talk is built the opposite way: tracking and review come first, and public claims come only after that work is done. Unit Talk will not publish performance claims unless the underlying data is tracked, reviewed, and approved for public release.',
  },
  {
    title: 'What Unit Talk tracks',
    body: 'Every published pick is recorded internally with its selection, the market it was made in, the price at publication, and the eventual outcome. This internal record is the foundation for everything that will eventually be public.',
    list: ['Picks — what was published and when', 'Prices — the market price attached to each pick', 'Outcomes — how each pick settled'],
  },
  {
    title: 'What will be public',
    body: 'A public transparency layer is being built: a pick archive, verified results, a methodology report, and a transparency dashboard. Public results will only display metrics that are properly tracked, reviewed, and approved for release.',
  },
  {
    title: 'What Unit Talk will not claim without verification',
    body: 'If you see a number on this site in the future, it will be one that passed internal tracking and review first.',
    list: [
      'Win rates, return figures, or profit numbers',
      'Closing-line or market-beating statistics',
      'Streaks, records, or ranking claims',
      'Testimonials presented as evidence of performance',
    ],
  },
];

export default function ResultsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Results & transparency"
        title="No invented numbers"
        lead="No cherry-picked screenshots. No fabricated performance claims. Here is exactly how Unit Talk handles results."
      />

      <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        {COMMITMENTS.map((item, i) => (
          <div key={item.title} className="ut-index-row">
            <span className="ut-index-num">{String(i + 1).padStart(2, '0')}</span>
            <div>
              <h2 className="text-base font-semibold">{item.title}</h2>
              <p className="ut-text-secondary mt-2 max-w-xl text-sm leading-relaxed">{item.body}</p>
              {item.list ? (
                <ul className="ut-text-secondary mt-3 max-w-xl space-y-1.5 text-sm">
                  {item.list.map((entry) => (
                    <li key={entry} className="flex items-start gap-2">
                      <span aria-hidden="true" className="ut-text-muted">—</span>
                      {entry}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ))}
      </section>

      <section className="border-t border-[var(--ut-border-subtle)] bg-[var(--ut-bg-surface)]">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <SectionHeader eyebrow="Coming soon" title="The transparency dashboard" align="center" />
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <ComingSoonCard title="Pick Archive" description="A reviewable archive of published picks and their recorded details." />
            <ComingSoonCard title="Verified Results" description="Outcomes published only after internal tracking and review." />
            <ComingSoonCard title="Methodology Report" description="How picks are produced, tracked, and evaluated." />
            <ComingSoonCard title="Transparency Dashboard" description="A public view into what Unit Talk tracks and releases." />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <ResponsiblePlayBanner />
      </section>
    </>
  );
}
