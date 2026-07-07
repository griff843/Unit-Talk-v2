import Link from 'next/link';
import { BRAND } from '@/lib/site-config';

export function ResponsiblePlayBanner() {
  return (
    <div className="ut-surface border-[var(--ut-warning)]/40 px-5 py-4">
      <p className="ut-text-secondary text-sm leading-relaxed">
        {BRAND.responsibleLine}{' '}
        <Link href="/responsible-play" className="font-medium text-[var(--ut-accent)] hover:underline">
          Read our responsible play commitment
        </Link>
        .
      </p>
    </div>
  );
}
