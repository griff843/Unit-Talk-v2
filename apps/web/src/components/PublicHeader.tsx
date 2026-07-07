'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BRAND, NAV_LINKS } from '@/lib/site-config';

export function PublicHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--ut-border-subtle)] bg-[var(--ut-bg-canvas)]/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2" aria-label="Unit Talk home">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--ut-accent)] text-sm font-bold text-white"
          >
            UT
          </span>
          <span className="text-sm font-bold tracking-[0.2em]">{BRAND.wordmark}</span>
        </Link>

        <nav className="hidden items-center gap-6 md:flex" aria-label="Main">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="ut-link text-sm font-medium">
              {link.label}
            </Link>
          ))}
          <Link href="/pricing" className="ut-btn-primary text-sm">
            Get Access
          </Link>
        </nav>

        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-md border border-[var(--ut-border-subtle)] md:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            {open ? (
              <path d="M3 3l12 12M15 3L3 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            ) : (
              <path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            )}
          </svg>
        </button>
      </div>

      {open ? (
        <nav
          id="mobile-menu"
          aria-label="Mobile"
          className="border-t border-[var(--ut-border-subtle)] bg-[var(--ut-bg-surface)] px-4 py-4 md:hidden"
        >
          <ul className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="ut-link block rounded-md px-3 py-2 text-sm font-medium"
                  onClick={() => setOpen(false)}
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <li className="pt-2">
              <Link
                href="/pricing"
                className="ut-btn-primary block w-full text-center text-sm"
                onClick={() => setOpen(false)}
              >
                Get Access
              </Link>
            </li>
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
