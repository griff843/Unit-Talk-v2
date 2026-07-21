#!/usr/bin/env tsx
/**
 * Singleton approval validator (UTV2-1570, implementation child of UTV2-1451).
 *
 * Replaces the self-asserted `--singleton-approved` flag in lane-start.ts
 * with `--singleton-approval-ref <Linear comment URL>`: fetches the
 * referenced Linear comment live via the GraphQL API, validates it against
 * a fixed schema (docs/05_operations/schemas/singleton-approval-v1.md),
 * confirms complete singleton-path coverage, and confirms the posting
 * user's identity matches the issue's own human owner (`creator`) -- an
 * artifact that had to be posted by the actual issue owner, not generated
 * inline by the same automated flow requesting the lane.
 *
 * Deliberately Linear-comment-based, not GitHub-PR-comment-based: singleton
 * approval is needed at lane-start time, before any PR exists, so the
 * artifact must be checkable pre-PR.
 */

export interface ParsedSingletonApproval {
  issue_id: string;
  paths: string[];
  reason: string;
}

export interface SingletonApprovalFailure {
  ok: false;
  code:
    | 'singleton_approval_malformed_ref'
    | 'singleton_approval_issue_mismatch'
    | 'singleton_approval_not_found'
    | 'singleton_approval_bot_author'
    | 'singleton_approval_wrong_author'
    | 'singleton_approval_schema_mismatch'
    | 'singleton_approval_incomplete_coverage'
    | 'singleton_approval_infra_error';
  message: string;
  uncovered_paths?: string[];
}

export interface SingletonApprovalSuccess {
  ok: true;
  code: 'singleton_approval_valid';
  message: string;
  approved_by: { id: string; name: string; email: string | null };
  covered_paths: string[];
}

export type SingletonApprovalResult = SingletonApprovalFailure | SingletonApprovalSuccess;

interface LinearUser {
  id: string;
  name: string;
  email: string | null;
}

interface LinearComment {
  id: string;
  url: string;
  body: string;
  user: LinearUser | null;
  botActor: { id: string } | null;
}

interface LinearIssueForApproval {
  id: string;
  identifier: string;
  creator: LinearUser | null;
  comments: { nodes: LinearComment[] };
}

// https://linear.app/<workspace>/issue/<ISSUE-ID>/<slug>[#comment-<id>]
const COMMENT_URL_PATTERN = /^https:\/\/linear\.app\/[^/]+\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)\/[^\s#]*(?:#comment-[0-9a-fA-F]+)?$/;

export function matchesLockPattern(filePath: string, pattern: string): boolean {
  if (pattern === filePath) {
    return true;
  }
  if (pattern.endsWith('/**')) {
    return filePath.startsWith(pattern.slice(0, -3));
  }
  if (pattern.endsWith('/*') && filePath.includes('/')) {
    const dirPart = `${filePath.slice(0, filePath.lastIndexOf('/'))}/`;
    return dirPart === pattern.slice(0, -1);
  }
  return false;
}

/**
 * Extract the issue identifier (e.g. "UTV2-1570") embedded in a Linear
 * comment permalink. Returns null for anything that doesn't look like a
 * well-formed Linear issue/comment URL.
 */
export function extractIssueIdFromCommentUrl(url: string): string | null {
  const match = url.trim().match(COMMENT_URL_PATTERN);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Parses a SINGLETON_APPROVED comment body. Returns null if the body does
 * not match the fixed schema (docs/05_operations/schemas/singleton-approval-v1.md).
 */
export function parseSingletonApprovalComment(body: string): ParsedSingletonApproval | null {
  const normalized = body.replace(/\r\n/g, '\n');
  const lines = normalized.split(/\r?\n/).map((l) => l.trim());
  if (lines[0] !== 'SINGLETON_APPROVED' || lines[1] !== 'schema: singleton-approval/v1') {
    return null;
  }

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
  if (!issueMatch || paths.length === 0) {
    return null;
  }

  return {
    issue_id: issueMatch[0],
    paths,
    reason: fields['Reason'] || '',
  };
}

async function fetchLinearIssueForApproval(
  issueId: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<LinearIssueForApproval | null> {
  const response = await fetchImpl('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `
        query SingletonApprovalIssue($id: String!) {
          issue(id: $id) {
            id
            identifier
            creator { id name email }
            comments(first: 250) {
              nodes {
                id
                url
                body
                user { id name email }
                botActor { id }
              }
            }
          }
        }
      `,
      variables: { id: issueId },
    }),
  });

  const payload = (await response.json()) as {
    data?: { issue: LinearIssueForApproval | null };
    errors?: Array<{ message?: string }>;
  };

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((e) => e.message ?? 'Unknown Linear error').join('; '));
  }

  return payload.data?.issue ?? null;
}

/**
 * Validates a --singleton-approval-ref against the issue being started and
 * the lane's declared singleton-only paths. Fails closed on any of:
 *   - malformed ref URL
 *   - ref's embedded issue ID does not match the issue being started
 *   - referenced comment does not exist on that issue
 *   - comment is bot-authored
 *   - comment author is not the issue's own creator (human owner)
 *   - comment body does not match the singleton-approval/v1 schema
 *   - comment's Paths: do not fully cover the lane's singleton-only paths
 */
export async function validateSingletonApprovalRef(params: {
  approvalRef: string;
  issueId: string;
  singletonPaths: string[];
  linearToken: string;
  fetchImpl?: typeof fetch;
}): Promise<SingletonApprovalResult> {
  const { approvalRef, issueId, singletonPaths, linearToken } = params;
  const fetchImpl = params.fetchImpl ?? fetch;

  const refIssueId = extractIssueIdFromCommentUrl(approvalRef);
  if (!refIssueId) {
    return {
      ok: false,
      code: 'singleton_approval_malformed_ref',
      message: `--singleton-approval-ref does not look like a Linear comment URL: ${approvalRef}`,
    };
  }

  const normalizedIssueId = issueId.toUpperCase();
  if (refIssueId !== normalizedIssueId) {
    return {
      ok: false,
      code: 'singleton_approval_issue_mismatch',
      message: `--singleton-approval-ref points at ${refIssueId}, but this lane is starting ${normalizedIssueId}.`,
    };
  }

  let issue: LinearIssueForApproval | null;
  try {
    issue = await fetchLinearIssueForApproval(normalizedIssueId, linearToken, fetchImpl);
  } catch (error) {
    return {
      ok: false,
      code: 'singleton_approval_infra_error',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (!issue) {
    return {
      ok: false,
      code: 'singleton_approval_not_found',
      message: `Linear issue ${normalizedIssueId} could not be resolved.`,
    };
  }

  // Match by exact url equality against the comment's own canonical url --
  // never by parsing/reconstructing a comment ID from the ref, since
  // Linear's URL fragment is a truncated 8-character prefix of the full
  // comment UUID, not the full ID.
  const comment = issue.comments.nodes.find((c) => c.url === approvalRef.trim());
  if (!comment) {
    return {
      ok: false,
      code: 'singleton_approval_not_found',
      message: `No comment on ${normalizedIssueId} matches the referenced URL exactly: ${approvalRef}`,
    };
  }

  if (comment.botActor) {
    return {
      ok: false,
      code: 'singleton_approval_bot_author',
      message: 'Referenced comment was posted by a bot account -- singleton approval must come from a human.',
    };
  }

  if (!issue.creator || !comment.user || comment.user.id !== issue.creator.id) {
    return {
      ok: false,
      code: 'singleton_approval_wrong_author',
      message: `Referenced comment was authored by ${comment.user?.name ?? 'an unknown user'}, but ${normalizedIssueId}'s owner is ${issue.creator?.name ?? 'unknown'}. Singleton approval must come from the issue's own creator.`,
    };
  }

  const parsed = parseSingletonApprovalComment(comment.body);
  if (!parsed) {
    return {
      ok: false,
      code: 'singleton_approval_schema_mismatch',
      message: 'Referenced comment does not match the singleton-approval/v1 schema (docs/05_operations/schemas/singleton-approval-v1.md).',
    };
  }

  if (parsed.issue_id !== normalizedIssueId) {
    return {
      ok: false,
      code: 'singleton_approval_schema_mismatch',
      message: `Comment's Issue: field (${parsed.issue_id}) does not match ${normalizedIssueId}.`,
    };
  }

  const uncovered = singletonPaths.filter(
    (filePath) => !parsed.paths.some((pattern) => matchesLockPattern(filePath, pattern)),
  );
  if (uncovered.length > 0) {
    return {
      ok: false,
      code: 'singleton_approval_incomplete_coverage',
      message: `Approval comment does not cover all singleton paths in this lane's scope: ${uncovered.join(', ')}`,
      uncovered_paths: uncovered,
    };
  }

  return {
    ok: true,
    code: 'singleton_approval_valid',
    message: `Valid singleton-approval/v1 comment from issue owner ${issue.creator.name} covers all singleton paths.`,
    approved_by: issue.creator,
    covered_paths: singletonPaths,
  };
}
