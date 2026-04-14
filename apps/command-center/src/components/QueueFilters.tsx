'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { Button } from '@/components/ui/Button';

const inputClass = 'rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

interface QueueFiltersProps {
  basePath: string;
}

export function QueueFilters({ basePath }: QueueFiltersProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const handleSubmit = useCallback((e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    for (const [key, val] of form.entries()) {
      const v = String(val).trim();
      if (v) params.set(key, v);
    }
    const qs = params.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  }, [router, basePath]);

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="queue-search" className="text-[10px] font-medium uppercase tracking-wide text-gray-500">Search</label>
        <input
          id="queue-search"
          name="search"
          type="text"
          defaultValue={searchParams.get('search') ?? ''}
          placeholder="Pick ID or market..."
          className={`w-44 ${inputClass}`}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="queue-source" className="text-[10px] font-medium uppercase tracking-wide text-gray-500">Source</label>
        <input
          id="queue-source"
          name="source"
          type="text"
          defaultValue={searchParams.get('source') ?? ''}
          placeholder="e.g. smart-form"
          className={`w-28 ${inputClass}`}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="queue-sort" className="text-[10px] font-medium uppercase tracking-wide text-gray-500">Sort</label>
        <select id="queue-sort" name="sort" defaultValue={searchParams.get('sort') ?? 'newest'} className={`w-24 ${inputClass}`}>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="score">Score</option>
        </select>
      </div>

      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm">Filter</Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => router.push(basePath)}>Clear</Button>
      </div>
    </form>
  );
}
