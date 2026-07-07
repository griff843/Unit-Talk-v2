import Link from 'next/link';
import { BRAND, LEGAL_LINKS, NAV_LINKS } from '@/lib/site-config';

export function PublicFooter() {
  return (
    <footer className="border-t border-[var(--ut-border-subtle)] bg-[var(--ut-bg-surface)]">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="flex flex-col gap-10 md:flex-row md:justify-between">
          <div className="max-w-sm">
            <p className="text-sm font-bold tracking-[0.2em]">{BRAND.wordmark}</p>
            <p className="ut-text-secondary mt-3 text-sm leading-relaxed">
              Premium sports betting intelligence delivered through Discord. Structured picks,
              market context, and a transparent process.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-10">
            <nav aria-label="Footer site">
              <p className="ut-text-muted text-xs font-semibold uppercase tracking-wider">Product</p>
              <ul className="mt-3 space-y-2">
                {NAV_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="ut-link text-sm">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <nav aria-label="Footer legal">
              <p className="ut-text-muted text-xs font-semibold uppercase tracking-wider">Legal</p>
              <ul className="mt-3 space-y-2">
                {LEGAL_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="ut-link text-sm">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </div>
        <div className="mt-10 border-t border-[var(--ut-border-subtle)] pt-6">
          <p className="ut-text-muted text-xs leading-relaxed">{BRAND.responsibleLine}</p>
          <p className="mt-2 text-xs font-medium text-[var(--ut-text-secondary)]">
            {BRAND.notASportsbook}
          </p>
          <p className="ut-text-muted mt-4 text-xs">
            © {new Date().getFullYear()} {BRAND.name}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
