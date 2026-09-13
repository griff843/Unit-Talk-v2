/**
 * Prevent overlapping browser submissions only. The API owns pick identity and
 * idempotency; this guard never decides whether a completed pick is a duplicate.
 */
export function createSessionSubmissionGuard() {
  let active = false;
  return {
    acquire(): 'acquired' | 'in-flight' {
      if (active) return 'in-flight';
      active = true;
      return 'acquired';
    },
    release(): void {
      active = false;
    },
  };
}
