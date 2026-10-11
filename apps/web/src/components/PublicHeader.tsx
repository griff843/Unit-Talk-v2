'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef, useState } from 'react';
import { BrandLogo } from './BrandLogo';
import { NAV_LINKS } from '@/lib/site-config';

export function PublicHeader() {
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  return (
    <header
      className="sticky top-0 z-50 border-b border-[var(--ut-border-subtle)] bg-[var(--ut-bg-canvas)]"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          setOpen(false);
          menuButton.current?.focus();
        }
      }}
    >
      <div className="ut-wrap flex h-20 items-center justify-between gap-6">
        <Link
          href="/"
          aria-label="Unit Talk home"
          onClick={() => setOpen(false)}
          className="shrink-0"
        >
          <BrandLogo
            compact
            priority
            className="h-[54px] w-[54px] rounded-full object-cover"
          />
        </Link>
        <nav
          aria-label="Main"
          className="ut-header-nav hidden items-center gap-6 lg:flex"
        >
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={pathname === link.href ? 'page' : undefined}
              className={
                pathname === link.href ? 'text-[var(--ut-signal)]' : 'ut-link'
              }
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="hidden lg:block">
          <Link href="/pricing" className="ut-btn ut-btn-primary">
            Explore membership <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <button
          ref={menuButton}
          type="button"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((value) => !value)}
          className="ut-btn ut-btn-secondary px-4 lg:hidden"
        >
          <span aria-hidden="true">{open ? '×' : '☰'}</span>
          <span>Menu</span>
        </button>
      </div>
      <nav
        hidden={!open}
        id="mobile-menu"
        aria-label="Mobile"
        className="ut-wrap border-t border-[var(--ut-border-subtle)] pb-5 pt-3 lg:hidden"
      >
        <ul>
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={pathname === link.href ? 'page' : undefined}
                onClick={() => setOpen(false)}
                className="ut-link block py-3"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
