/**
 * Scoped operator roles and authority matrices (UTV2-1108 / INIT-2.4.1).
 *
 * Closes Gap #22: service_role is unrestricted; separation of duties is convention only.
 * This module defines explicit, revocable roles with declared domain scopes and
 * an authority matrix that enforces separation-of-duties at the contract boundary.
 */

/** Canonical domain identifiers — each maps to a distinct authority boundary. */
export const AUTHORITY_DOMAINS = [
  'picks:read',
  'picks:submit',
  'picks:settle',
  'picks:grade',
  'picks:post',
  'picks:void',
  'picks:override',
  'outbox:enqueue',
  'outbox:deliver',
  'outbox:retry',
  'settlement:record',
  'settlement:correct',
  'promotion:evaluate',
  'promotion:override',
  'recap:generate',
  'recap:post',
  'audit:read',
  'member:read',
  'member:write',
  'operator:admin',
] as const;

export type AuthorityDomain = (typeof AUTHORITY_DOMAINS)[number];

/**
 * A scoped operator role — explicitly declares which domains the role may act in.
 * Revocable: removing the role from the authority matrix immediately drops all authority.
 */
export interface OperatorRole {
  /** Unique role identifier */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Domains this role is authorized to act in */
  domains: readonly AuthorityDomain[];
  /** Whether this role can delegate authority to other roles */
  can_delegate: boolean;
  /** Whether this role can perform cross-domain actions (two-domain writes in one call) */
  cross_domain_allowed: boolean;
}

/**
 * Authority matrix entry — maps a role ID to its scoped authority declaration.
 * Acts as the canonical source of truth for separation-of-duties enforcement.
 */
export interface AuthorityMatrix {
  schema_version: 1;
  /** Ordered list of roles. Later entries do not override earlier ones. */
  roles: readonly OperatorRole[];
}

/**
 * The canonical authority matrix for Unit Talk V2.
 * Cross-domain actions that violate this matrix must be rejected.
 */
export const AUTHORITY_MATRIX: AuthorityMatrix = {
  schema_version: 1,
  roles: [
    {
      id: 'submitter',
      name: 'Pick Submitter',
      domains: ['picks:submit', 'picks:read'],
      can_delegate: false,
      cross_domain_allowed: false,
    },
    {
      id: 'settler',
      name: 'Pick Settler',
      domains: ['picks:settle', 'picks:grade', 'picks:read', 'settlement:record', 'settlement:correct'],
      can_delegate: false,
      cross_domain_allowed: false,
    },
    {
      id: 'poster',
      name: 'Pick Poster',
      domains: ['picks:post', 'picks:read', 'outbox:enqueue'],
      can_delegate: false,
      cross_domain_allowed: false,
    },
    {
      id: 'worker',
      name: 'Outbox Worker',
      domains: ['outbox:deliver', 'outbox:retry', 'picks:read'],
      can_delegate: false,
      cross_domain_allowed: false,
    },
    {
      id: 'operator',
      name: 'Operator',
      domains: [
        'picks:read',
        'picks:override',
        'picks:void',
        'promotion:evaluate',
        'promotion:override',
        'recap:generate',
        'recap:post',
        'audit:read',
        'member:read',
        'member:write',
        'operator:admin',
        'outbox:retry',
      ],
      can_delegate: true,
      cross_domain_allowed: true,
    },
    {
      id: 'capper',
      name: 'Capper',
      domains: ['picks:submit', 'picks:read'],
      can_delegate: false,
      cross_domain_allowed: false,
    },
  ],
};

/** Look up a role in the canonical authority matrix by its ID. */
export function getRole(roleId: string): OperatorRole | undefined {
  return AUTHORITY_MATRIX.roles.find((r) => r.id === roleId);
}

/**
 * Assert that `roleId` is permitted to perform a multi-domain operation.
 * Single-domain calls always pass. Two or more domains require `cross_domain_allowed: true`.
 * Throws `AuthorityViolationError` fail-closed if the role lacks cross-domain permission.
 */
export function assertCrossDomainAllowed(
  roleId: string,
  domains: readonly AuthorityDomain[],
): void {
  if (domains.length <= 1) return;
  const firstDomain = domains[0] as AuthorityDomain;
  const role = getRole(roleId);
  if (!role) {
    throw new AuthorityViolationError(
      `AUTHORITY_VIOLATION: unknown role '${roleId}' — cannot authorize cross-domain operation [domains=${domains.join(',')}] ERRCODE=AUTHORITY_VIOLATION`,
      roleId,
      firstDomain,
    );
  }
  if (!role.cross_domain_allowed) {
    throw new AuthorityViolationError(
      `AUTHORITY_VIOLATION: role '${roleId}' has cross_domain_allowed=false — multi-domain operation rejected [domains=${domains.join(',')}] ERRCODE=AUTHORITY_VIOLATION`,
      roleId,
      firstDomain,
    );
  }
}

/**
 * Assert that `roleId` has authority over `domain`.
 * Throws `AuthorityViolationError` if the assertion fails — this is the
 * separation-of-duties enforcement gate.
 */
export function assertAuthority(roleId: string, domain: AuthorityDomain): void {
  const role = getRole(roleId);
  if (!role) {
    throw new AuthorityViolationError(
      `AUTHORITY_VIOLATION: unknown role '${roleId}' — all roles must be declared in the authority matrix`,
      roleId,
      domain,
    );
  }
  if (!(role.domains as readonly string[]).includes(domain)) {
    throw new AuthorityViolationError(
      `AUTHORITY_VIOLATION: role '${roleId}' is not authorized for domain '${domain}' — separation-of-duties violation`,
      roleId,
      domain,
    );
  }
}

/**
 * Check (non-throwing) whether `roleId` has authority over `domain`.
 */
export function hasAuthority(roleId: string, domain: AuthorityDomain): boolean {
  const role = getRole(roleId);
  return role !== undefined && (role.domains as readonly string[]).includes(domain);
}

/** Thrown when an operator attempts an action outside their declared authority scope. */
export class AuthorityViolationError extends Error {
  readonly code = 'AUTHORITY_VIOLATION' as const;
  readonly roleId: string;
  readonly domain: AuthorityDomain;

  constructor(message: string, roleId: string, domain: AuthorityDomain) {
    super(message);
    this.name = 'AuthorityViolationError';
    this.roleId = roleId;
    this.domain = domain;
  }
}
