// scripts/ops/agent-result-schema.ts — UTV2-1007
// Canonical JSON result schema for governance agents.
// All CI-eligible governance checks must emit this shape.

export type AgentVerdict = 'PASS' | 'FAIL' | 'WARN' | 'SKIP';

export interface EvidenceRef {
  path: string;
  sha: string | null;
  description?: string;
}

export interface AgentResult {
  schema_version: 1;
  agent: string;           // e.g. "runtime-verifier", "proof-auditor", "lane-reconciler"
  verdict: AgentVerdict;
  issueId: string | null;
  sha: string | null;      // the SHA this result is bound to
  generatedAt: string;     // ISO-8601
  failures: string[];
  warnings: string[];
  evidenceRefs: EvidenceRef[];
  detail?: unknown;        // agent-specific extra data
}

// Type guard
export function isAgentResult(value: unknown): value is AgentResult {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    r['schema_version'] === 1 &&
    typeof r['agent'] === 'string' &&
    ['PASS', 'FAIL', 'WARN', 'SKIP'].includes(r['verdict'] as string) &&
    Array.isArray(r['failures']) &&
    Array.isArray(r['warnings']) &&
    Array.isArray(r['evidenceRefs']) &&
    typeof r['generatedAt'] === 'string'
  );
}

// Builder helper
export function buildAgentResult(
  agent: string,
  verdict: AgentVerdict,
  opts: {
    issueId?: string | null;
    sha?: string | null;
    failures?: string[];
    warnings?: string[];
    evidenceRefs?: EvidenceRef[];
    detail?: unknown;
  } = {},
): AgentResult {
  return {
    schema_version: 1,
    agent,
    verdict,
    issueId: opts.issueId ?? null,
    sha: opts.sha ?? null,
    generatedAt: new Date().toISOString(),
    failures: opts.failures ?? [],
    warnings: opts.warnings ?? [],
    evidenceRefs: opts.evidenceRefs ?? [],
    detail: opts.detail,
  };
}
