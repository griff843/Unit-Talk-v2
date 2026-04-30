import { OpsWorkspace, normalizeRole } from '@/components/OpsWorkspace';

export default function OpsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const rawRole = typeof searchParams?.role === 'string' ? searchParams.role.toUpperCase() : undefined;

  return <OpsWorkspace role={normalizeRole(rawRole)} />;
}
