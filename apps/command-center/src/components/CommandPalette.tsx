'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { lookupPicks } from '@/app/actions/pick-lookup';
import {
  filterCommands,
  moveActiveIndex,
  pickSearchEntry,
  pickResultEntry,
  type CommandEntry,
} from '@/lib/command-palette-model';

type CommandPaletteProps = {
  entries: CommandEntry[];
  open: boolean;
  onClose: () => void;
};

export function CommandPalette({ entries, open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [picks, setPicks] = useState<CommandEntry[]>([]);
  const [lookupError, setLookupError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const pickEntry = pickSearchEntry(query);
    const matches = filterCommands(entries, query);
    return [...picks.map((entry) => ({ ...entry, score: 100 })), ...(pickEntry ? [{ ...pickEntry, score: 100 }] : []), ...matches].slice(0, 12);
  }, [entries, query, picks]);

  useEffect(() => {
    let cancelled = false;
    setPicks([]);
    setLookupError('');
    if (!open || query.trim().length < 3 || query.trim().length > 100) return;
    const timer = window.setTimeout(() => {
      void lookupPicks(query).then((result) => {
        if (cancelled) return;
        if (!result.ok) { setLookupError(result.error); return; }
        setPicks(result.picks.map(pickResultEntry).filter((entry): entry is CommandEntry => entry !== null));
      }).catch(() => { if (!cancelled) setLookupError('Pick lookup unavailable. Try again.'); });
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [open, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, picks]);

  const go = useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = moveActiveIndex(activeIndex, event.key === 'ArrowDown' ? 1 : -1, results.length);
      setActiveIndex(next);
      listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = results[activeIndex];
      if (target) go(target.href);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-cc-canvas/70 px-4 pt-[12vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Jump to surface"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-cc-line bg-cc-surface shadow-[0_32px_80px_-24px_rgba(0,0,0,0.8)]">
        <div className="flex items-center gap-3 border-b border-cc-line px-4 py-3">
          <span className="text-cc-ink-3" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search surfaces or picks"
            className="w-full bg-transparent text-sm text-cc-ink placeholder:text-cc-ink-3 focus:outline-none"
            aria-label="Search surfaces or picks"
          />
          <kbd className="rounded border border-cc-line px-1.5 py-0.5 text-[10px] uppercase text-cc-ink-3">esc</kbd>
        </div>
        {lookupError && <p role="alert" className="px-4 pt-2 text-sm text-amber-300">{lookupError}</p>}
        <ul ref={listRef} className="max-h-[50vh] overflow-y-auto py-2" role="listbox">
          {results.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-cc-ink-3">No surface matches “{query}”.</li>
          )}
          {results.map((result, index) => (
            <li key={result.href} role="option" aria-selected={index === activeIndex}>
              <button
                type="button"
                onClick={() => go(result.href)}
                onMouseEnter={() => setActiveIndex(index)}
                className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                  index === activeIndex ? 'bg-cc-accent/15 text-cc-ink' : 'text-cc-ink-2 hover:bg-cc-hover'
                }`}
              >
                <span className="min-w-0"><span className="block truncate">{result.label}</span>{result.detail && <span className="block text-xs text-cc-ink-3">{result.detail}</span>}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-[10px] uppercase tracking-[0.2em] text-cc-ink-3">{result.group}</span>
                  <span className="font-mono text-[11px] text-cc-ink-3">{result.href}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-4 border-t border-cc-line px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-cc-ink-3">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>⌘K toggle</span>
        </div>
      </div>
    </div>
  );
}
