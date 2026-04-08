'use client';

import { useState } from 'react';

interface DetailPaneProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export function DetailPane({ title, children, defaultOpen = false }: DetailPaneProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-gray-200">{title}</span>
        <svg
          className={`h-4 w-4 flex-shrink-0 text-gray-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div
        className={`overflow-hidden transition-all duration-200 ease-in-out ${open ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}
      >
        <div className="border-t border-gray-800 px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
