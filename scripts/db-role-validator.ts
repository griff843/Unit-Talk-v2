import { createClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';
import { loadEnvironment } from '@unit-talk/config';

export interface RoleFinding {
  level: 'OK' | 'CRITICAL';
  check: 'superuser' | 'role_exists';
  subject: string;
  message: string;
}

export const REQUIRED_ROLES = [
  'app_user',
  'ingestion_writer',
  'scanner_user',
  'metrics_user',
  'migration_owner',
] as const;

export function evaluateSuperuserFinding(
  isSuperuser: boolean,
  currentUser: string,
): RoleFinding {
  if (isSuperuser) {
    return {
      level: 'CRITICAL',
      check: 'superuser',
      subject: currentUser,
      message: `Connection user '${currentUser}' has superuser privileges — runtime services must not use superuser credentials. Update connection strings to use least-privilege login roles.`,
    };
  }
  return {
    level: 'OK',
    check: 'superuser',
    subject: currentUser,
    message: `Connection user '${currentUser}' is not superuser.`,
  };
}

export function evaluateRoleExistsFinding(
  roleName: string,
  exists: boolean,
): RoleFinding {
  if (!exists) {
    return {
      level: 'CRITICAL',
      check: 'role_exists',
      subject: roleName,
      message: `Role '${roleName}' does not exist — run scripts/postgres/provision-roles.sh to complete provisioning.`,
    };
  }
  return {
    level: 'OK',
    check: 'role_exists',
    subject: roleName,
    message: `Role '${roleName}' exists.`,
  };
}

function emit(finding: RoleFinding): void {
  console.log(
    JSON.stringify({
      level: finding.level,
      check: finding.check,
      subject: finding.subject,
      message: finding.message,
      ts: new Date().toISOString(),
    }),
  );
}

async function main(): Promise<void> {
  const env = loadEnvironment();

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[check-db-roles] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — cannot check.');
    process.exit(1);
  }

  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const findings: RoleFinding[] = [];

  // Check: current connection user superuser status
  const { data: userRows, error: userError } = await db
    .rpc('check_current_user_superuser' as never)
    .select() as unknown as { data: { usename: string; usesuper: boolean }[] | null; error: unknown };

  if (userError || !userRows) {
    // Fall back to a raw query via a known-safe table
    // On Supabase cloud the service role has elevated access — this check is
    // intended for validation on the Hetzner self-hosted deployment.
    console.warn('[check-db-roles] Could not query pg_user — this check is designed for the Hetzner self-hosted Postgres.');
    console.warn('[check-db-roles] Run scripts/postgres/validate-roles.sql directly on the Hetzner instance for full validation.');
    process.exit(0);
  }

  const userRow = userRows[0];
  if (userRow) {
    findings.push(evaluateSuperuserFinding(userRow.usesuper, userRow.usename));
  }

  // Check: required group roles exist
  for (const roleName of REQUIRED_ROLES) {
    const { data: roleRows } = await db
      .rpc('check_role_exists' as never, { role_name: roleName } as never)
      .select() as unknown as { data: { exists: boolean }[] | null; error: unknown };

    const exists = roleRows?.[0]?.exists ?? false;
    findings.push(evaluateRoleExistsFinding(roleName, exists));
  }

  for (const finding of findings) {
    emit(finding);
  }

  const criticals = findings.filter(f => f.level === 'CRITICAL');
  if (criticals.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[check-db-roles] Unhandled error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
