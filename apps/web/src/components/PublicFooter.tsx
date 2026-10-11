import Link from 'next/link';
import { BrandLogo } from './BrandLogo';
import { BRAND, LEGAL_LINKS, NAV_LINKS } from '@/lib/site-config';
export function PublicFooter() {
  return (
    <footer className="ut-rule bg-[var(--ut-bg-surface)]">
      <div className="ut-wrap py-14">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-[1.4fr_1fr_1fr]">
          <div className="col-span-2 md:col-span-1">
            <Link href="/" aria-label="Unit Talk home">
              <BrandLogo className="ut-footer-logo" />
            </Link>
            <p className="ut-text-secondary mt-5 max-w-sm text-sm">
              Official capper picks. A complete settled record. A community
              built around the sport.
            </p>
            <p className="ut-text-muted mt-4 max-w-sm text-xs">
              {BRAND.notASportsbook}
            </p>
          </div>
          <nav aria-label="Footer site">
            <p className="ut-eyebrow">Explore</p>
            <ul className="mt-5 space-y-1">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <Link className="ut-link text-sm" href={link.href}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Footer legal">
            <p className="ut-eyebrow">Help & information</p>
            <ul className="mt-5 space-y-1">
              {LEGAL_LINKS.map((link) => (
                <li key={link.href}>
                  <Link className="ut-link text-sm" href={link.href}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="ut-text-muted mt-5 text-xs">
              Terms and Privacy are drafts pending legal review.
            </p>
          </nav>
        </div>
        <div className="ut-rule mt-12 flex flex-col justify-between gap-4 pt-6 md:flex-row">
          <p className="ut-text-muted max-w-3xl text-xs">
            {BRAND.responsibleLine}
          </p>
          <p className="ut-text-muted shrink-0 text-xs">
            © {new Date().getFullYear()} Unit Talk
          </p>
        </div>
      </div>
    </footer>
  );
}
