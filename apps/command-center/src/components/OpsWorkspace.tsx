export type OpsRole = 'ADMIN' | 'OPS' | 'VIEWER';

export function normalizeRole(raw: string | undefined): OpsRole {
  if (raw === 'ADMIN') return 'ADMIN';
  if (raw === 'OPS') return 'OPS';
  return 'VIEWER';
}

export function OpsWorkspace({ role }: { role: OpsRole }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-lg font-bold text-gray-100">Ops</h1>
        <p className="text-sm text-gray-500">Operational controls and overrides.</p>
      </div>
      <div className="rounded-lg border border-gray-800 bg-gray-900/50 px-6 py-8 text-center text-sm text-gray-500">
        Ops workspace (role: {role}) coming soon.
      </div>
    </div>
  );
}
