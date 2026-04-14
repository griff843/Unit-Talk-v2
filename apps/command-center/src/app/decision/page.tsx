import Link from 'next/link';

interface DecisionModule {
  name: string;
  href: string;
  description: string;
  status: 'live' | 'shell';
  statusDetail: string;
}

const modules: DecisionModule[] = [
  {
    name: 'Board Queue',
    href: '/decision/board-queue',
    description: 'Review governed board candidates before picks are written.',
    status: 'live',
    statusDetail: 'Connected to board queue and write-surface workflows.',
  },
  {
    name: 'Score Breakdown',
    href: '/decision/scores',
    description: 'Inspect promotion score components and operator-facing rationale.',
    status: 'live',
    statusDetail: 'Useful when a capper asks why a pick qualified or failed.',
  },
  {
    name: 'Promotion Preview',
    href: '/decision/preview',
    description: 'Preview qualification, target routing, and intervention options.',
    status: 'live',
    statusDetail: 'Best operator surface for promotion sanity checks.',
  },
  {
    name: 'Routing Preview',
    href: '/decision/routing',
    description: 'Validate downstream channel routing and guardrail decisions.',
    status: 'live',
    statusDetail: 'Helps explain why a pick can or cannot reach a live target.',
  },
  {
    name: 'Board Saturation',
    href: '/decision/board',
    description: 'Monitor slate capacity and risk of overloading a board.',
    status: 'live',
    statusDetail: 'Supports board-cap management and sequencing decisions.',
  },
  {
    name: 'Hedge Overlays',
    href: '/decision/hedges',
    description: 'Reserved for hedge-specific overlays and counter-position guidance.',
    status: 'shell',
    statusDetail: 'Route exists, but the workflow is still a shell.',
  },
];

const statusClasses: Record<DecisionModule['status'], string> = {
  live: 'border-emerald-700 bg-emerald-900/40 text-emerald-300',
  shell: 'border-gray-700 bg-gray-800 text-gray-300',
};

const statusLabels: Record<DecisionModule['status'], string> = {
  live: 'Live',
  shell: 'Shell',
};

export default function DecisionPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Decision</p>
        <h1 className="mt-1 text-xl font-bold text-white">Decision Workspace</h1>
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
                {module.name}
              </h2>
              <span
                className={`inline-flex rounded border px-2 py-0.5 text-[10px] font-medium ${statusClasses[module.status]}`}
              >
                {statusLabels[module.status]}
              </span>
            </div>
            <p className="text-xs text-gray-400">{module.description}</p>
            <p className="text-[10px] text-gray-600">{module.statusDetail}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
