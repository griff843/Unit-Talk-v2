import React from 'react';

export function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="cc-surface p-5">
      {title && (
        <h2 className="cc-text-secondary mb-4 text-sm font-semibold uppercase tracking-wide">
          {title}
        </h2>
      )}
      {children}
    </div>
  );
}
