// Mirrors the inline parser in .github/workflows/file-scope-lock-check.yml's
// "Collect authorized scope-override comments" step. Extracted here so the
// field-extraction logic has unit test coverage (UTV2-1524) -- GitHub Actions'
// actions/github-script step body cannot import a TS module directly, so the
// workflow keeps its own copy; keep the two in lockstep on any future change.

export interface ParsedScopeOverride {
  issue_id: string;
  pr_number: number;
  head_sha: string;
  paths: string[];
  reason: string;
}

export function parseScopeOverrideComment(body: string): ParsedScopeOverride | null {
  const normalized = body.replace(/\r\n/g, '\n');
  const lines = normalized.split(/\r?\n/).map((l) => l.trim());
  if (lines[0] !== 'SCOPE_OVERRIDE: APPROVED' || lines[1] !== 'schema: scope-override/v1') {
    return null;
  }

  // Fields (Issue/PR/Head-SHA/Reason) may appear before OR after the Paths:
  // block -- the schema doc's own documented example places Reason after
  // Paths. Walk every line after the two-line header, treating "Paths:" as
  // the start of a contiguous "- " bullet list and everything else as a
  // "Key: value" field, regardless of position relative to it.
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
