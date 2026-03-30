'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

const LIFECYCLE_OPTIONS = ['', 'validated', 'queued', 'posted', 'settled', 'voided'];
const APPROVAL_OPTIONS = ['', 'pending', 'approved', 'rejected'];

function SelectFilter({ name, value, options, label }: {
  name: string;
  value: string;
  options: string[];
  label: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] uppercase text-gray-500">{label}</label>
      <select
        name={name}
        defaultValue={value}
        className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt || 'All'}</option>
        ))}
      </select>
    </div>
  );
}

export function PickFilters() {
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
    router.push(`/picks-list?${params.toString()}`);
  }, [router]);

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-[10px] uppercase text-gray-500">Search</label>
        <input
          name="q"
          type="text"
          defaultValue={searchParams.get('q') ?? ''}
          placeholder="Pick ID, market, selection..."
          className="w-56 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200 placeholder-gray-500"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] uppercase text-gray-500">Source</label>
        <input
          name="source"
          type="text"
          defaultValue={searchParams.get('source') ?? ''}
          placeholder="e.g. smart-form"
          className="w-28 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200 placeholder-gray-500"
        />
      </div>

      <SelectFilter
        name="status"
        value={searchParams.get('status') ?? ''}
        options={LIFECYCLE_OPTIONS}
        label="Lifecycle"
      />

      <SelectFilter
        name="approval"
        value={searchParams.get('approval') ?? ''}
        options={APPROVAL_OPTIONS}
        label="Approval"
      />

      <div className="flex flex-col gap-1">
        <label className="text-[10px] uppercase text-gray-500">Sport</label>
        <input
          name="sport"
          type="text"
          defaultValue={searchParams.get('sport') ?? ''}
          placeholder="e.g. NBA"
          className="w-20 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200 placeholder-gray-500"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] uppercase text-gray-500">From</label>
        <input
          name="dateFrom"
          type="date"
          defaultValue={searchParams.get('dateFrom') ?? ''}
          className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] uppercase text-gray-500">To</label>
        <input
          name="dateTo"
          type="date"
          defaultValue={searchParams.get('dateTo') ?? ''}
          className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200"
        />
      </div>

      <button
        type="submit"
        className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
      >
        Search
      </button>

      <button
        type="button"
        onClick={() => router.push('/picks-list')}
        className="rounded border border-gray-600 px-3 py-1 text-xs text-gray-400 hover:bg-gray-800"
      >
        Clear
      </button>
    </form>
  );
}
