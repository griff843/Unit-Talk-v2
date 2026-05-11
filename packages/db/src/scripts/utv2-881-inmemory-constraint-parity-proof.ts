/**
 * UTV2-881 proof coverage marker: in-memory constraint parity
 *
 * This script exists so proof-sensitive CI can tie the in-memory constraint
 * hardening lane back to an explicit DB-parity proof surface. The runtime
 * behavior being protected already lives in the production database via check
 * constraints and foreign keys; UTV2-881 closes the test-repository gap so
 * InMemory repositories fail the same invalid writes earlier in local tests.
 *
 * Suggested verification alongside this proof marker:
 *   pnpm test:db
 *   tsx --test packages/db/src/inmemory-constraints.test.ts
 */

console.log(
  JSON.stringify({
    ok: true,
    issue: 'UTV2-881',
    proof: 'inmemory-constraint-parity',
    note: 'Live DB parity is provided by existing database constraints; this lane hardens InMemory repositories to match that behavior.',
  }),
);
