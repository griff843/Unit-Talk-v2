import Link from 'next/link';
import { getWorkspaceRoutes } from '@/lib/command-center-nav';

export const metadata = { title: 'Decision — Unit Talk Command Center' };

export default function DecisionPage() {
  const modules = getWorkspaceRoutes('decision');

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="mt-2 text-sm text-gray-400">
          Promotion engine transparency for score breakdowns, routing, and board management.
          Start from a module below instead of navigating blind.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((module) => (
          <Link
            key={module.href}
            href={module.href}
            className="group flex flex-col gap-3 rounded border border-gray-800 bg-gray-900/50 p-4 transition-colors hover:border-gray-700 hover:bg-gray-800/50"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-200 group-hover:text-white">
                {module.label}
              </h2>
              <span
                className="inline-flex rounded border border-gray-700 bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-gray-300"
              >
                {module.classification}
              </span>
            </div>
            <p className="text-xs text-gray-400">{module.description}</p>
            <p className="text-[10px] text-gray-600">{module.classificationReason}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
