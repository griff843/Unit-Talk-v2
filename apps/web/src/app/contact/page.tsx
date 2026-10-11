import { pageMetadata } from '@/lib/site-metadata';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CTAButton } from '@/components/CTAButton';
import { PageHeader } from '@/components/PageHeader';
import { ResponsiblePlayBanner } from '@/components/ResponsiblePlayBanner';
import { PAGE_TITLES } from '@/lib/site-config';
const description =
  'Unit Talk support information for existing Discord members and public visitors. A public Discord invite and dedicated support email are unavailable here.';
export const metadata: Metadata = pageMetadata(
  PAGE_TITLES.contact,
  description,
  '/contact',
);
export default function ContactPage() {
  return (
    <>
      <PageHeader
        eyebrow="Support"
        title="Support where the community lives."
        lead="Existing members can use their established Unit Talk Discord support area. Public contact options are limited on this website."
      />
      <section className="ut-wrap ut-section pt-0">
        <div className="ut-split">
          <article className="ut-panel p-7">
            <p className="ut-eyebrow">Existing members</p>
            <h2 className="ut-subheading mt-3">
              Use your Discord support area.
            </h2>
            <p className="ut-text-secondary mt-4 leading-relaxed">
              For membership or access questions, use the support area in the
              Unit Talk Discord you already belong to. We do not promise
              response times here.
            </p>
          </article>
          <article className="ut-panel p-7">
            <p className="ut-eyebrow">Public visitors</p>
            <h2 className="ut-subheading mt-3">
              No public invite or email is published.
            </h2>
            <p className="ut-text-secondary mt-4 leading-relaxed">
              This site does not offer a contact form, verified public Discord
              invite or dedicated support email. Please review the{' '}
              <Link href="/faq" className="ut-inline-link">
                FAQ
              </Link>{' '}
              for membership and availability information.
            </p>
            <CTAButton href="/faq" variant="secondary" className="mt-6">
              Read the FAQ
            </CTAButton>
          </article>
        </div>
        <div className="mt-10">
          <ResponsiblePlayBanner />
        </div>
      </section>
    </>
  );
}
