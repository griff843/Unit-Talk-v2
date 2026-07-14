import Link from 'next/link';
import { BRAND, RESPONSIBLE_GAMBLING_RESOURCES } from '@/lib/site-config';

export function ResponsiblePlayBanner() {
  return (
    <div className="ut-panel ut-notch border-l-2 border-l-[var(--ut-signal)] p-5 sm:p-6">
      <p className="ut-eyebrow">Responsible play</p>
      <p className="ut-text-secondary mt-3 text-sm leading-relaxed">
        {BRAND.responsibleLine}{' '}
        <Link href="/responsible-play" className="font-medium text-[var(--ut-signal)] hover:underline">
          Read our responsible play commitment
        </Link>
        .
      </p>
      <ul className="mt-4 flex flex-wrap gap-2">
        {RESPONSIBLE_GAMBLING_RESOURCES.map((resource) => (
          <li key={resource.name}>
            {resource.href ? (
              <a href={resource.href} className="ut-tag transition-colors hover:border-[var(--ut-signal)] hover:text-[var(--ut-signal)]">
                {resource.name}
              </a>
            ) : (
              <span className="ut-tag">{resource.name}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
