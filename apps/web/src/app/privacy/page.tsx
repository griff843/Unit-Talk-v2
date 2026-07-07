import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDisclaimer } from '@/components/LegalDisclaimer';
import { PageHeader } from '@/components/PageHeader';
import { PAGE_TITLES } from '@/lib/site-config';

const description = 'Unit Talk privacy policy (draft, pending legal review).';

export const metadata: Metadata = {
  title: { absolute: PAGE_TITLES.privacy },
  description,
  openGraph: { title: PAGE_TITLES.privacy, description, type: 'website', siteName: 'Unit Talk' },
  twitter: { card: 'summary', title: PAGE_TITLES.privacy, description },
};

export default function PrivacyPage() {
  return (
    <>
      <PageHeader title="Privacy Policy" />
      <section className="mx-auto max-w-3xl px-4 pb-20 sm:px-6">
        <LegalDisclaimer>
          This privacy policy is a working draft. It describes intended practices but has not yet
          been reviewed by counsel. A final version will be published before paid memberships
          launch.
        </LegalDisclaimer>

        <div className="ut-prose mt-8">
          <h2>1. Information collected</h2>
          <p>
            Unit Talk collects only the information needed to operate the service: account details
            you provide, your Discord identity for channel access, and basic usage information.
          </p>

          <h2>2. Account and contact information</h2>
          <p>
            When you join, we collect your name or handle and contact details. This is used to
            manage your membership and communicate service updates.
          </p>

          <h2>3. Payments</h2>
          {/* TODO(legal-review): payment processor not yet selected; update once finalized. */}
          <p>
            Payments will be handled by a third-party payment processor. Unit Talk will not store
            full card numbers. Processor details are a placeholder pending selection.
          </p>

          <h2>4. Discord access</h2>
          <p>
            Connecting your Discord account shares your Discord user ID and username with Unit Talk
            so the correct channels can be unlocked. Your activity in Discord is also subject to
            Discord&apos;s own privacy policy.
          </p>

          <h2>5. Analytics and cookies</h2>
          {/* TODO(legal-review): analytics tooling not yet selected; update once finalized. */}
          <p>
            The site may use privacy-conscious analytics and necessary cookies. Specific tools and
            cookie details are a placeholder pending final selection.
          </p>

          <h2>6. How information is used</h2>
          <p>
            Information is used to provide the service, manage memberships, deliver alerts,
            improve the product, and meet legal obligations. It is not used to build advertising
            profiles.
          </p>

          <h2>7. Sharing</h2>
          <p>
            Unit Talk does not sell personal information. Data is shared only with service
            providers needed to operate the product (such as the payment processor and Discord) or
            when required by law.
          </p>

          <h2>8. Security</h2>
          <p>
            Reasonable technical and organizational measures are used to protect member data. No
            system is perfectly secure, and members should protect their own account credentials.
          </p>

          <h2>9. Your choices</h2>
          <p>
            You may request access to, correction of, or deletion of your personal information, and
            you may disconnect your Discord account or cancel your membership at any time.
          </p>

          <h2>10. Contact</h2>
          {/* TODO(support-email): no approved public support email yet; support runs through Discord. */}
          <p>
            Privacy questions are currently handled through the Unit Talk Discord — see the{' '}
            <Link href="/contact" className="text-[var(--ut-accent)] hover:underline">
              contact page
            </Link>
            . A dedicated privacy contact will be listed here after launch.
          </p>

          <h2>11. Legal review</h2>
          <p>
            This entire policy is pending legal review and may change materially before launch. The
            published date of the final version will appear here.
          </p>
        </div>
      </section>
    </>
  );
}
