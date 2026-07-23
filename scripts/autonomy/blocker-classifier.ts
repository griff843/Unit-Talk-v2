import {
  type BlockerFinding,
  type CheckFact,
  type EvidenceFact,
  type MechanicalFacts,
} from './contracts.js';

export interface BlockerClassification {
  blocking: BlockerFinding[];
  advisories: BlockerFinding[];
  mechanically_dispatchable: boolean;
}

function finding(
  category: BlockerFinding['category'],
  code: string,
  severity: BlockerFinding['severity'],
  source: string,
  detail: string,
): BlockerFinding {
  return { category, code, severity, source, detail };
}

function classifyRequiredCheck(
  check: CheckFact,
  headSha: string,
): BlockerFinding | null {
  if (!check.required) return null;
  if (check.status === 'missing') {
    return finding(
      'required_checks',
      'REQUIRED_CHECK_MISSING',
      'blocker',
      check.name,
      `Required check ${check.name} has no result`,
    );
  }
  if (check.sha !== headSha) {
    return finding(
      'required_checks',
      'REQUIRED_CHECK_STALE',
      'blocker',
      check.name,
      `Required check ${check.name} is not bound to the current head`,
    );
  }
  if (
    check.status !== 'completed' ||
    !['success', 'neutral', 'skipped'].includes(check.conclusion ?? '')
  ) {
    return finding(
      'required_checks',
      'REQUIRED_CHECK_NOT_PASSING',
      'blocker',
      check.name,
      `Required check ${check.name} is ${check.conclusion ?? check.status}`,
    );
  }
  return null;
}

function classifyEvidence(
  category: 'executor_result' | 'pm_verdict' | 'scope_override',
  evidence: EvidenceFact,
  headSha: string,
  observedAt: string,
): BlockerFinding[] {
  if (!evidence.required) return [];
  const label =
    category === 'executor_result'
      ? 'executor result'
      : category === 'pm_verdict'
        ? 'PM verdict'
        : 'scope override';
  const prefix = category.toUpperCase();
  if (!evidence.present) {
    return [
      finding(
        category,
        `${prefix}_MISSING`,
        'blocker',
        label,
        `Required ${label} is missing`,
      ),
    ];
  }
  if (!evidence.authenticated) {
    return [
      finding(
        category,
        `${prefix}_UNTRUSTED`,
        'escalation',
        label,
        `${label} is not authenticated by a trusted source`,
      ),
    ];
  }
  if (evidence.head_sha !== headSha) {
    return [
      finding(
        category,
        `STALE_${prefix}`,
        'blocker',
        label,
        `${label} is bound to a different head SHA`,
      ),
    ];
  }
  if (
    evidence.expires_at &&
    Date.parse(evidence.expires_at) <= Date.parse(observedAt)
  ) {
    return [
      finding(
        category,
        `EXPIRED_${prefix}`,
        'blocker',
        label,
        `${label} has expired`,
      ),
    ];
  }
  const acceptedStatuses =
    category === 'pm_verdict' ? ['approved'] : ['valid', 'approved'];
  if (!acceptedStatuses.includes(evidence.status ?? '')) {
    return [
      finding(
        category,
        `${prefix}_NOT_ACCEPTED`,
        'blocker',
        label,
        `${label} status is ${evidence.status ?? 'unknown'}`,
      ),
    ];
  }
  return [];
}

export function classifyBlockers(
  facts: MechanicalFacts,
): BlockerClassification {
  const all: BlockerFinding[] = [];

  for (const check of facts.checks) {
    const required = classifyRequiredCheck(check, facts.head_sha);
    if (required) all.push(required);
    if (
      !check.required &&
      check.status === 'completed' &&
      ['failure', 'cancelled', 'timed_out'].includes(check.conclusion ?? '')
    ) {
      all.push(
        finding(
          'advisory_workflow',
          'ADVISORY_WORKFLOW_FAILURE',
          'advisory',
          check.name,
          `Non-required workflow ${check.name} concluded ${check.conclusion}`,
        ),
      );
    }
  }

  all.push(
    ...classifyEvidence(
      'executor_result',
      facts.executor_result,
      facts.head_sha,
      facts.observed_at,
    ),
    ...classifyEvidence(
      'pm_verdict',
      facts.pm_verdict,
      facts.head_sha,
      facts.observed_at,
    ),
    ...classifyEvidence(
      'scope_override',
      facts.scope_override,
      facts.head_sha,
      facts.observed_at,
    ),
  );

  if (facts.unresolved_review_threads > 0) {
    all.push(
      finding(
        'review_threads',
        'UNRESOLVED_REVIEW_THREADS',
        'blocker',
        'github.reviewThreads',
        `${facts.unresolved_review_threads} review thread(s) remain unresolved`,
      ),
    );
  }
  for (const label of facts.required_labels.filter(
    (entry) => !facts.labels.includes(entry),
  )) {
    all.push(
      finding(
        'labels',
        'MISSING_REQUIRED_LABEL',
        'blocker',
        label,
        `Required label ${label} is missing`,
      ),
    );
  }
  if (facts.behind_by > 0) {
    all.push(
      finding(
        'branch_base',
        'BRANCH_BEHIND_BASE',
        'blocker',
        'github.compare',
        `Branch is ${facts.behind_by} commit(s) behind base`,
      ),
    );
  }
  if (facts.merge_conflicts) {
    all.push(
      finding(
        'merge_conflicts',
        'MERGE_CONFLICTS_PRESENT',
        'blocker',
        'github.mergeable',
        'Branch has merge conflicts',
      ),
    );
  }
  for (const lease of facts.locks_and_leases) {
    if (
      lease.status === 'released' ||
      lease.owner_session_id === facts.current_session_id
    )
      continue;
    if (lease.status === 'stale_reclaim_required') {
      all.push(
        finding(
          'locks_leases',
          'STALE_LOCK_OR_LEASE_REQUIRES_RECLAIM',
          'escalation',
          lease.resource,
          `${lease.kind} requires explicit audited reclaim`,
        ),
      );
    } else if (Date.parse(lease.expires_at) > Date.parse(facts.observed_at)) {
      all.push(
        finding(
          'locks_leases',
          'ACTIVE_LOCK_OR_LEASE',
          'blocker',
          lease.resource,
          `${lease.kind} is held by another stable session`,
        ),
      );
    } else {
      all.push(
        finding(
          'locks_leases',
          'EXPIRED_LOCK_OR_LEASE_REQUIRES_RECLAIM',
          'escalation',
          lease.resource,
          `${lease.kind} expired and must be explicitly reclaimed`,
        ),
      );
    }
  }
  if (
    facts.protected_file_expansion.detected &&
    (!facts.protected_file_expansion.authorized ||
      !facts.protected_file_expansion.authenticated)
  ) {
    all.push(
      finding(
        'protected_files',
        'PROTECTED_FILE_EXPANSION_UNAUTHORIZED',
        'escalation',
        facts.protected_file_expansion.paths.slice().sort().join(','),
        'Protected-file expansion lacks trusted authorization',
      ),
    );
  }
  if (
    facts.environment.required &&
    (!facts.environment.approved || facts.environment.state !== 'approved')
  ) {
    all.push(
      finding(
        'environment_approval',
        'ENVIRONMENT_APPROVAL_REQUIRED',
        'blocker',
        'github.environment',
        `Environment approval state is ${facts.environment.state}`,
      ),
    );
  }
  if (facts.github_mergeability !== 'MERGEABLE') {
    all.push(
      finding(
        'github_mergeability',
        facts.github_mergeability === 'UNKNOWN'
          ? 'GITHUB_MERGEABILITY_UNKNOWN'
          : 'GITHUB_MERGEABILITY_NOT_READY',
        'blocker',
        'github.mergeStateStatus',
        `GitHub mergeability state is ${facts.github_mergeability}`,
      ),
    );
  }

  all.sort((left, right) =>
    `${left.code}:${left.source}`.localeCompare(
      `${right.code}:${right.source}`,
    ),
  );
  const advisories = all.filter((entry) => entry.severity === 'advisory');
  const blocking = all.filter((entry) => entry.severity !== 'advisory');
  return {
    blocking,
    advisories,
    mechanically_dispatchable: blocking.length === 0,
  };
}
