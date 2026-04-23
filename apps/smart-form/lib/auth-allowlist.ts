export interface AllowedCapper {
  email: string;
  capperId: string;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function deriveCapperIdFromEmail(email: string): string {
  const normalized = normalizeEmail(email);
  const [localPart] = normalized.split('@');
  return (localPart ?? '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

export function parseAllowedCapperEmails(value: string | undefined): AllowedCapper[] {
  if (!value) return [];

  const cappers = value
    .split(',')
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean)
    .map((email) => ({ email, capperId: deriveCapperIdFromEmail(email) }))
    .filter((capper) => capper.capperId);

  return Array.from(new Map(cappers.map((capper) => [capper.email, capper])).values());
}

export function findAllowedCapper(
  email: string | null | undefined,
  allowedCappers: readonly AllowedCapper[],
): AllowedCapper | null {
  if (!email) return null;
  const normalized = normalizeEmail(email);
  return allowedCappers.find((capper) => capper.email === normalized) ?? null;
}
