/**
 * Regression pin on WHICH requests Next.js hands to the Command Center
 * middleware.
 *
 * Every other auth test in this app drives `middleware()` directly, so they all
 * assume it ran. That assumption was false: the matcher was
 * `/((?!.*\..*).*)` — "every path that contains no dot" — so Next never invoked
 * middleware for any dotted path, and authentication was skipped entirely
 * rather than evaluated and denied. A test that calls `middleware()` itself
 * cannot see that class of bug, which is why this file tests the matcher.
 *
 * Measured against a running server with authentication required:
 *
 *     GET /picks/abc      -> 401   (middleware ran)
 *     GET /picks/abc.def  -> 200   (middleware never ran)
 *
 * `/picks/[id]` is a real dynamic route, so any id containing a dot rendered
 * the operator page unauthenticated and executed its server components, which
 * hold privileged database access.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../middleware.js';

/**
 * Approximates Next's middleware matching: each `matcher` entry is a path
 * pattern anchored at both ends. Good enough to answer the only question that
 * matters here — is this pathname handed to middleware at all?
 */
function isMatched(pathname: string): boolean {
  return config.matcher.some((pattern) => new RegExp(`^${pattern}$`).test(pathname));
}

// ── the routes that must always be authenticated ──────────────────────────

const PROTECTED_PATHS = [
  '/',
  '/decisions',
  '/picks/abc',
  '/operations/governance',
  '/api/events',
  '/api/governance/lanes',
];

for (const pathname of PROTECTED_PATHS) {
  test(`middleware is invoked for ${pathname}`, () => {
    assert.equal(isMatched(pathname), true);
  });
}

// ── the actual defect ─────────────────────────────────────────────────────
// These fail against the old dot-excluding matcher. They are the whole point
// of the file.

const DOTTED_PROTECTED_PATHS = [
  '/picks/abc.def',
  '/picks/00000000-0000-0000-0000-000000000000.json',
  '/operations/governance.x',
  '/api/events.',
  '/decisions/a.b/c',
];

for (const pathname of DOTTED_PROTECTED_PATHS) {
  test(`a dot in the path does not skip middleware: ${pathname}`, () => {
    assert.equal(
      isMatched(pathname),
      true,
      'a path must not be able to opt out of authentication by containing a dot',
    );
  });
}

test('the matcher contains no dot-shape exclusion', () => {
  // Pins the mechanism, not just its symptoms: a future edit that reintroduces
  // "exclude anything with a dot" fails here even if it picks paths this
  // suite does not enumerate.
  for (const pattern of config.matcher) {
    assert.ok(
      !pattern.includes('\\.'),
      `matcher "${pattern}" excludes paths by shape; exclusions must name literal prefixes`,
    );
  }
});

// ── what may legitimately skip middleware ─────────────────────────────────

test('Next build output skips middleware', () => {
  assert.equal(isMatched('/_next/static/chunks/main.js'), false);
  assert.equal(isMatched('/_next/image'), false);
});

// Public routes now reach middleware and are allowed by isPublicPath instead of
// by the matcher. One decision, in tested code, rather than split between a
// regex and a list that can disagree.
test('public application routes still reach middleware', () => {
  assert.equal(isMatched('/api/health'), true);
  assert.equal(isMatched('/favicon.ico'), true);
  assert.equal(isMatched('/icon.svg'), true);
});
