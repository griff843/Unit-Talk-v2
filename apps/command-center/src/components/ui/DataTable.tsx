'use client';

import { useState } from 'react';

export interface Column<T> {
  key: keyof T;
  label: string;
  render?: (val: T[keyof T], row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  emptyMessage?: string;
}

type SortDir = 'asc' | 'desc';

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  loading = false,
  emptyMessage = 'No data available.',
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<keyof T | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  function handleSort(key: keyof T) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const sorted =
    sortKey == null
      ? data
      : [...data].sort((a, b) => {
          const av = a[sortKey];
          const bv = b[sortKey];
          if (av == null && bv == null) return 0;
          if (av == null) return 1;
          if (bv == null) return -1;
          const cmp =
            typeof av === 'number' && typeof bv === 'number'
              ? av - bv
              : String(av).localeCompare(String(bv));
          return sortDir === 'asc' ? cmp : -cmp;
        });

  if (loading) {
    return (
      <div className="overflow-x-auto animate-pulse">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-700">
              {columns.map((col) => (
                <th key={String(col.key)} className="py-2 pr-4 text-xs uppercase text-gray-600">
                  <div className="h-3 w-16 rounded bg-gray-800" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 3 }).map((_, i) => (
              <tr key={i} className="border-b border-gray-800/50">
                {columns.map((col) => (
                  <td key={String(col.key)} className="py-2.5 pr-4">
                    <div className="h-3 w-full max-w-[120px] rounded bg-gray-800" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="flex items-center justify-center py-10 text-sm text-gray-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-700">
            {columns.map((col) => {
              const isActive = sortKey === col.key;
              return (
                <th
                  key={String(col.key)}
                  className="py-2 pr-4 text-xs font-medium uppercase tracking-wide text-gray-400 select-none"
                >
                  <button
                    type="button"
                    onClick={() => handleSort(col.key)}
                    className="flex items-center gap-1 hover:text-gray-200 transition-colors"
                  >
                    {col.label}
                    <span className={`text-[10px] ${isActive ? 'text-gray-300' : 'text-gray-700'}`}>
                      {isActive ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, rowIdx) => (
            <tr
              key={rowIdx}
              className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
            >
              {columns.map((col) => {
                const val = row[col.key];
                return (
                  <td key={String(col.key)} className="py-2.5 pr-4 text-xs text-gray-300">
                    {col.render ? col.render(val, row) : String(val ?? '')}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
