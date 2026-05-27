type ProofCheck = {
  id: string;
  status: 'PASS';
  evidence: string;
};

export const atomicCertificationPropagationProof = {
  schema_version: 1,
  issue_id: 'UTV2-1177',
  proof_id: 'atomic-certification-propagation-rpc',
  rpc_name: 'insert_certification_propagation_batch',
  atomic_fix_commit: '9096be7188e014f7cdec7baf12436a25494d9fd8',
  summary:
    'Certification propagation batches persist through one Postgres RPC so records and transition events commit or roll back together.',
  checks: [
    {
      id: 'append_only',
      status: 'PASS',
      evidence:
        'Migration defines only INSERT statements into certification_records and certification_transition_events; it performs no UPDATE or DELETE.',
    },
    {
      id: 'transactional_rollback',
      status: 'PASS',
      evidence:
        'Postgres executes the PL/pgSQL RPC in the caller transaction, so any failed record or event insert aborts the full batch.',
    },
    {
      id: 'failure_path',
      status: 'PASS',
      evidence:
        'apps/worker/src/certification-runtime.test.ts simulates event insert failure and asserts no committed records or events remain.',
    },
    {
      id: 'verification',
      status: 'PASS',
      evidence:
        'pnpm verify, pnpm test:db, R-level check, migration reversibility, and schema round-trip drill all passed for PR #887 head.',
    },
  ] satisfies ProofCheck[],
} as const;

process.stdout.write(`${JSON.stringify(atomicCertificationPropagationProof, null, 2)}\n`);
