import { pageMetadata } from '@/lib/site-metadata';
import type { Metadata } from 'next';
import { FAQAccordion } from '@/components/FAQAccordion';
import { CTAButton } from '@/components/CTAButton';
import { PageHeader } from '@/components/PageHeader';
import { PAGE_TITLES } from '@/lib/site-config';
import { FAQ_ITEMS } from '@/lib/faq';
const description =
  'Answers about Unit Talk, Free settled history, the $1 seven-day full VIP Trial, $49.99/month VIP, Discord, unavailable features and responsible play.';
export const metadata: Metadata = pageMetadata(
  PAGE_TITLES.faq,
  description,
  '/faq',
);
export default function FAQPage() {
  return (
    <>
      <PageHeader
        eyebrow="FAQ"
        title="Clear answers. In plain terms."
        lead="Membership, results, Discord and the limits of what is available on this website."
      />
      <section className="ut-wrap ut-section pt-0">
        <div className="max-w-3xl">
          <FAQAccordion items={[...FAQ_ITEMS]} />
          <div className="ut-actions mt-8">
            <CTAButton href="/pricing">Explore membership</CTAButton>
            <CTAButton href="/contact" variant="secondary">
              Support information
            </CTAButton>
          </div>
        </div>
      </section>
    </>
  );
}
