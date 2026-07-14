import Link from 'next/link';
import { BRAND, LEGAL_LINKS, NAV_LINKS, RESPONSIBLE_GAMBLING_RESOURCES } from '@/lib/site-config';

export function PublicFooter() {
  return (
    <footer className="border-t border-[var(--ut-border-subtle)] bg-[var(--ut-bg-surface)]">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <p className="ut-num text-sm font-bold tracking-[0.22em]">{BRAND.wordmark}</p>
            <p className="ut-text-secondary mt-3 max-w-sm text-sm leading-relaxed">
              A premium sports-betting intelligence desk delivered through Discord. Structured
              picks, market context, and a transparent process.
            </p>
            <p className="ut-text-muted mt-4 text-xs font-medium uppercase tracking-wider">
              {BRAND.notASportsbook}
            </p>
          </div>

          <nav aria-label="Footer site">
            <p className="ut-tag">Product</p>
            <ul className="mt-4 space-y-2.5">
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
            <p className="ut-tag">Legal &amp; support</p>
            <ul className="mt-4 space-y-2.5">
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

        <div className="mt-12 border-t border-[var(--ut-border-subtle)] pt-6">
          <p className="ut-text-muted text-xs leading-relaxed">{BRAND.responsibleLine}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
            {RESPONSIBLE_GAMBLING_RESOURCES.map((resource, i) => (
              <span key={resource.name} className="ut-text-muted text-xs">
                {resource.href ? (
                  <a href={resource.href} className="ut-link">
                    {resource.name}
                  </a>
                ) : (
                  resource.name
                )}
                {i < RESPONSIBLE_GAMBLING_RESOURCES.length - 1 ? (
                  <span aria-hidden="true"> ·</span>
                ) : null}
              </span>
            ))}
          </div>
          <p className="ut-text-muted mt-5 text-xs">
            © {new Date().getFullYear()} {BRAND.name}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
