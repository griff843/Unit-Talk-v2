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

export default function ResultsPage() {
  return (
    <>
      <PageHeader
        title="Results & transparency"
        lead="No cherry-picked screenshots. No invented numbers. Here is exactly how Unit Talk handles performance."
      />

      <section className="mx-auto max-w-3xl space-y-6 px-4 pb-16 sm:px-6">
        <div className="ut-surface p-6">
          <h2 className="text-lg font-semibold">1. Transparency is part of the product</h2>
          <p className="ut-text-secondary mt-3 text-sm leading-relaxed">
            Most pick services show you their best week and hide the rest. Unit Talk is built the
            opposite way: tracking and review come first, and public claims come only after that
            work is done. Unit Talk will not publish performance claims unless the underlying data
            is tracked, reviewed, and approved for public release.
          </p>
        </div>

        <div className="ut-surface p-6">
          <h2 className="text-lg font-semibold">2. What Unit Talk tracks</h2>
          <p className="ut-text-secondary mt-3 text-sm leading-relaxed">
            Every published pick is recorded internally with its selection, the market it was made
            in, the price at publication, and the eventual outcome. This internal record is the
            foundation for everything that will eventually be public.
          </p>
          <ul className="ut-text-secondary mt-3 list-disc space-y-1 pl-6 text-sm">
            <li>Picks — what was published and when</li>
            <li>Prices — the market price attached to each pick</li>
            <li>Outcomes — how each pick settled</li>
          </ul>
        </div>

        <div className="ut-surface p-6">
          <h2 className="text-lg font-semibold">3. What will be public</h2>
          <p className="ut-text-secondary mt-3 text-sm leading-relaxed">
            A public transparency layer is being built: a pick archive, verified results, a
            methodology report, and a transparency dashboard. Public results will only display
            metrics that are properly tracked, reviewed, and approved for release.
          </p>
        </div>

        <div className="ut-surface p-6">
          <h2 className="text-lg font-semibold">4. What Unit Talk will not claim without verification</h2>
          <ul className="ut-text-secondary mt-3 list-disc space-y-1 pl-6 text-sm">
            <li>Win rates, return figures, or profit numbers</li>
            <li>Closing-line or market-beating statistics</li>
            <li>Streaks, records, or ranking claims</li>
            <li>Testimonials presented as evidence of performance</li>
          </ul>
          <p className="ut-text-secondary mt-3 text-sm leading-relaxed">
            If you see a number on this site in the future, it will be one that passed internal
            tracking and review first.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <SectionHeader title="5. The transparency dashboard — coming soon" />
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <ComingSoonCard title="Pick Archive" description="A reviewable archive of published picks and their recorded details." />
          <ComingSoonCard title="Verified Results" description="Outcomes published only after internal tracking and review." />
          <ComingSoonCard title="Methodology Report" description="How picks are produced, tracked, and evaluated." />
          <ComingSoonCard title="Transparency Dashboard" description="A public view into what Unit Talk tracks and releases." />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <ResponsiblePlayBanner />
      </section>
    </>
  );
}
