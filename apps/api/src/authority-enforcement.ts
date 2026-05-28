/**
 * Authority enforcement adapter for apps/api (UTV2-1108 / INIT-2.4.1).
 *
 * Bridges the AuthContext (role string) from apps/api/src/auth.ts with the
 * formal authority matrix from @unit-talk/contracts. Provides the runtime
 * gate that rejects cross-domain actions from underprivileged operators.
 */

import {
  type AuthorityDomain,
  type AuthorityViolationError,
  assertAuthority,
  hasAuthority,
} from '@unit-talk/contracts';

import type { AuthContext } from './auth.js';

export type { AuthorityDomain };
export { AuthorityViolationError };

/**
 * Assert that the authenticated context has authority over the given domain.
 * Throws AuthorityViolationError if the role is not declared for the domain.
 *
 * Usage in a route handler:
 *   enforceAuthority(authContext, 'picks:post');  // throws if not authorized
 */
export function enforceAuthority(context: AuthContext, domain: AuthorityDomain): void {
  assertAuthority(context.role, domain);
}

/**
 * Check (non-throwing) whether the authenticated context can act in a domain.
 */
export function canActIn(context: AuthContext, domain: AuthorityDomain): boolean {
  return hasAuthority(context.role, domain);
}

/**
 * Assert multiple domain authorities at once. All must pass.
 * Use when a single operation spans two domains to enforce cross-domain restrictions.
 */
export function enforceAllAuthorities(context: AuthContext, domains: AuthorityDomain[]): void {
  for (const domain of domains) {
    assertAuthority(context.role, domain);
  }
}
