/**
 * Test-only: flatten a React element tree to the primitive values it carries.
 *
 * Some page surfaces mount client components that need the app router, so
 * `renderToStaticMarkup` refuses on them. The element tree is what the RSC
 * Flight payload is serialized from, so scanning it is the honest fallback —
 * an HTML prefix or a status code would prove nothing about its contents.
 */
export function serializeElementTree(node: unknown, seen = new Set<unknown>()): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
    return String(node);
  }
  if (typeof node !== 'object') return '';
  if (seen.has(node)) return '';
  seen.add(node);
  if (Array.isArray(node)) return node.map((entry) => serializeElementTree(entry, seen)).join(' ');
  return Object.values(node as Record<string, unknown>)
    .map((value) => serializeElementTree(value, seen))
    .join(' ');
}
