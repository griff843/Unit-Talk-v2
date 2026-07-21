// Mirrors the inline parser the tier-c-authorization-gate.yml workflow uses
// in its "Collect authorized tier-c-approval comments" step. Extracted here
// so the field-extraction logic has unit test coverage (UTV2-1570) --
// GitHub Actions' actions/github-script step body cannot import a TS module
// directly, so the workflow keeps its own copy; keep the two in lockstep on
// any future change. Structurally this is scope-override-comment-parser.ts's
// twin -- same shape, different schema header and comment name -- reused
// deliberately (docs/05_operations/schemas/tier-c-approval-v1.md: "one trust
// primitive, not two").

export interface ParsedTierCApproval {
  issue_id: string;
  pr_number: number;
  head_sha: string;
  paths: string[];
  reason: string;
}

export function parseTierCApprovalComment(body: string): ParsedTierCApproval | null {
  const normalized = body.replace(/\r\n/g, '\n');
  const lines = normalized.split(/\r?\n/).map((l) => l.trim());
  if (lines[0] !== 'TIER_C_APPROVAL: APPROVED' || lines[1] !== 'schema: tier-c-approval/v1') {
    return null;
  }

  // Fields (Issue/PR/Head-SHA/Reason) may appear before OR after the Paths:
  // block -- same documented flexibility as scope-override/v1. Walk every
  // line after the two-line header, treating "Paths:" as the start of a
  // contiguous "- " bullet list and everything else as a "Key: value"
  // field, regardless of position relative to it.
  const fields: Record<string, string> = {};
  const paths: string[] = [];
  let i = 2;
  while (i < lines.length) {
    const line = lines[i];
    if (line === 'Paths:') {
      i += 1;
      while (i < lines.length && lines[i].startsWith('- ')) {
        const p = lines[i].slice(2).trim();
        if (p) paths.push(p);
        i += 1;
      }
      continue;
    }
    const match = line.match(/^([A-Za-z-]+):\s*(.+)$/);
    if (match) fields[match[1]] = match[2].trim();
    i += 1;
  }

  const issueMatch = (fields['Issue'] || '').match(/^UTV2-\d+$/);
  const prMatch = (fields['PR'] || '').match(/^#(\d+)$/);
  if (!issueMatch || !prMatch || !fields['Head-SHA'] || paths.length === 0) {
    return null;
  }

  return {
    issue_id: issueMatch[0],
    pr_number: Number.parseInt(prMatch[1], 10),
    head_sha: fields['Head-SHA'],
    paths,
    reason: fields['Reason'] || '',
  };
}
