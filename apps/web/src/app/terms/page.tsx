import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDisclaimer } from '@/components/LegalDisclaimer';
import { PageHeader } from '@/components/PageHeader';
import { PAGE_TITLES } from '@/lib/site-config';

const description = 'Unit Talk terms of service (draft, pending legal review).';

export const metadata: Metadata = {
  title: { absolute: PAGE_TITLES.terms },
  description,
  openGraph: { title: PAGE_TITLES.terms, description, type: 'website', siteName: 'Unit Talk' },
  twitter: { card: 'summary', title: PAGE_TITLES.terms, description },
};

export default function TermsPage() {
  return (
    <>
      <PageHeader eyebrow="Legal" title="Terms of Service" />
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <LegalDisclaimer>
          These terms are a working draft. They describe the intended operating principles of Unit
          Talk but have not yet been reviewed by counsel. Final terms will be published before paid
          memberships launch.
        </LegalDisclaimer>

        <div className="ut-prose mt-8">
          <h2>1. Acceptance of terms</h2>
          <p>
            By accessing the Unit Talk website or Discord community, you agree to these terms. If
            you do not agree, do not use the service.
          </p>

          <h2>2. Information and entertainment product</h2>
          <p>
            Unit Talk provides sports betting information, analysis, and community features for
            informational and entertainment purposes only. Nothing provided by Unit Talk is
            financial, legal, or investment advice.
          </p>

          <h2>3. No sportsbook functionality</h2>
          <p>
            Unit Talk is not a sportsbook. It does not accept, place, broker, or facilitate wagers,
            and it does not hold member funds for wagering.
          </p>

          <h2>4. No guarantee of outcomes</h2>
          <p>
            Sports betting involves risk. Unit Talk makes no promises about the outcome of any pick
            or the results of any member&apos;s betting activity.
          </p>

          <h2>5. User responsibility</h2>
          <p>
            All betting decisions are the member&apos;s alone. Members are responsible for
            complying with the laws of their jurisdiction, including legal wagering age
            requirements.
          </p>

          <h2>6. Responsible betting</h2>
          <p>
            Members should only wager what they can afford to lose. See the{' '}
            <Link href="/responsible-play" className="text-[var(--ut-signal)] hover:underline">
              responsible play page
            </Link>{' '}
            for Unit Talk&apos;s full commitment.
          </p>

          <h2>7. Memberships and payments</h2>
          {/* TODO(legal-review): billing, refund, and cancellation terms pending payment-provider selection and legal review. */}
          <p>
            Membership tiers, billing cycles, refund policy, and cancellation mechanics will be
            described here once pricing and payment processing are finalized. This section is a
            placeholder.
          </p>

          <h2>8. Discord and community access</h2>
          <p>
            Access to member channels is provided through Discord and is subject to community
            conduct rules. Unit Talk may remove access for abusive behavior, harassment, or
            attempts to misrepresent the service.
          </p>

          <h2>9. Limitation of liability</h2>
          {/* TODO(legal-review): liability language requires counsel drafting. */}
          <p>
            To the maximum extent permitted by law, Unit Talk is not liable for losses arising from
            betting decisions made by members. Full liability language is a placeholder pending
            legal review.
          </p>

          <h2>10. Support and contact</h2>
          {/* TODO(support-email): no approved public support email yet; support runs through Discord. */}
          <p>
            Support is currently provided through the Unit Talk Discord. See the{' '}
            <Link href="/contact" className="text-[var(--ut-signal)] hover:underline">
              contact page
            </Link>
            . A formal contact channel will be listed here after launch.
          </p>

          <h2>11. Legal review</h2>
          <p>
            This entire document is pending legal review and may change materially before launch.
            The published date of the final version will appear here.
          </p>
        </div>
      </section>
    </>
  );
}
