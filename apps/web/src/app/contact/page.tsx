import type { Metadata } from 'next';
import Link from 'next/link';
import { CTAButton } from '@/components/CTAButton';
import { PageHeader } from '@/components/PageHeader';
import { ResponsiblePlayBanner } from '@/components/ResponsiblePlayBanner';
import { CONTACT, PAGE_TITLES } from '@/lib/site-config';

const description =
  'Get support from Unit Talk. Member support is handled through the Discord community.';

export const metadata: Metadata = {
  title: { absolute: PAGE_TITLES.contact },
  description,
  openGraph: { title: PAGE_TITLES.contact, description, type: 'website', siteName: 'Unit Talk' },
  twitter: { card: 'summary', title: PAGE_TITLES.contact, description },
};

export default function ContactPage() {
  return (
    <>
      <PageHeader
        eyebrow="Support"
        title="Contact Unit Talk"
        lead="Support lives where the product lives — in Discord."
      />

      <section className="mx-auto max-w-3xl space-y-5 px-4 py-16 sm:px-6">
        <div className="ut-panel ut-notch p-6 text-center">
          <h2 className="text-lg font-semibold">{CONTACT.supportChannel}</h2>
          <p className="ut-text-secondary mt-3 text-sm leading-relaxed">
            The fastest way to reach the team is through the support channels inside the Unit Talk
            Discord. Membership questions, access issues, and general questions are all handled
            there.
          </p>
          {/* TODO(discord-invite): wire the real Discord invite URL from site-config once created (UTV2-1482). */}
          <div className="mt-6">
            <CTAButton href="/pricing">Get Access to the Discord</CTAButton>
          </div>
        </div>

        <div className="ut-panel-elevated p-6">
          <h2 className="text-base font-semibold">Check the FAQ first</h2>
          <p className="ut-text-secondary mt-2 text-sm leading-relaxed">
            Most questions about tiers, access, cancellation, and results are already answered on
            the{' '}
            <Link href="/faq" className="text-[var(--ut-signal)] hover:underline">
              FAQ page
            </Link>
            .
          </p>
        </div>

        <div className="ut-panel-elevated p-6">
          <h2 className="text-base font-semibold">Other channels</h2>
          {/* TODO(support-email): no approved public support email exists yet; add here once provisioned (UTV2-1482). */}
          <p className="ut-text-secondary mt-2 text-sm leading-relaxed">
            A dedicated support email will be published here before launch. Until then, Discord is
            the official support channel.
          </p>
        </div>

        <ResponsiblePlayBanner />
      </section>
    </>
  );
}
