'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { Button } from '@/components/ui/Button';

const inputClass = 'rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';
const labelClass = 'text-[10px] font-medium uppercase tracking-wide text-gray-500';

const LIFECYCLE_OPTIONS = ['', 'validated', 'queued', 'posted', 'settled', 'voided'];
const APPROVAL_OPTIONS = ['', 'pending', 'approved', 'rejected'];
const RESULT_OPTIONS = ['', 'win', 'loss', 'push', 'void'];

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
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col gap-1">
        <label className={labelClass}>Search</label>
        <input
          name="q"
          type="text"
          defaultValue={searchParams.get('q') ?? ''}
          placeholder="Pick ID, market, selection..."
          className={`w-52 ${inputClass}`}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelClass}>Source</label>
        <input
          name="source"
          type="text"
          defaultValue={searchParams.get('source') ?? ''}
          placeholder="e.g. smart-form"
          className={`w-28 ${inputClass}`}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelClass}>Lifecycle</label>
        <select name="status" defaultValue={searchParams.get('status') ?? ''} className={`w-28 ${inputClass}`}>
          {LIFECYCLE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{opt || 'All'}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelClass}>Approval</label>
        <select name="approval" defaultValue={searchParams.get('approval') ?? ''} className={`w-28 ${inputClass}`}>
          {APPROVAL_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{opt || 'All'}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelClass}>Result</label>
        <select name="result" defaultValue={searchParams.get('result') ?? ''} className={`w-24 ${inputClass}`}>
          {RESULT_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{opt || 'All'}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelClass}>Capper</label>
        <input
          name="capper"
          type="text"
          defaultValue={searchParams.get('capper') ?? ''}
          placeholder="Name..."
          className={`w-24 ${inputClass}`}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelClass}>Sport</label>
        <input
          name="sport"
          type="text"
          defaultValue={searchParams.get('sport') ?? ''}
          placeholder="e.g. NBA"
          className={`w-20 ${inputClass}`}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelClass}>From</label>
        <input
          name="dateFrom"
          type="date"
          defaultValue={searchParams.get('dateFrom') ?? ''}
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelClass}>To</label>
        <input
          name="dateTo"
          type="date"
          defaultValue={searchParams.get('dateTo') ?? ''}
          className={inputClass}
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm">Search</Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => router.push('/picks-list')}>Clear</Button>
      </div>
    </form>
  );
}
