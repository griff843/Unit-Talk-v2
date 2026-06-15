import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'live-schema-parity.yml');

test('live-schema-parity workflow wires compare output through the drift gate', () => {
  const text = fs.readFileSync(workflowPath, 'utf8');
  const workflow = YAML.parse(text) as {
    jobs?: {
      'schema-parity'?: {
        steps?: Array<Record<string, unknown>>;
      };
    };
  };

  const steps = workflow.jobs?.['schema-parity']?.steps ?? [];
  const compareStep = steps.find((step) => step.name === 'Compare scratch schema to live schema');
  const gateStep = steps.find((step) => step.name === 'Authorize schema drift gate');
  const artifactStep = steps.find((step) => step.name === 'Upload schema parity artifact');

  assert.ok(compareStep);
  assert.ok(gateStep);
  assert.ok(artifactStep);
  assert.strictEqual(compareStep?.id, 'compare');
  assert.strictEqual(compareStep?.['continue-on-error'], true);
  assert.strictEqual(gateStep?.if, 'always()');
  // Invoked via `pnpm exec tsx <script>` rather than a `pnpm <pkg-script> -- <args>` alias:
  // the latter forwards a literal `--` that the gate's arg parser rejects. (UTV2-1274)
  assert.match(String(gateStep?.run ?? ''), /pnpm exec tsx scripts\/ci\/schema-drift-gate\.ts/);
  assert.match(String(gateStep?.run ?? ''), /--report artifacts\/schema-parity\/live-schema-parity\.json/);
  assert.match(String(artifactStep?.with ? (artifactStep.with as Record<string, unknown>).path : ''), /artifacts\/schema-parity\/?/);
  assert.match(text, /scripts\/ci\/schema-drift-gate\.ts/);
});

test('live-schema-parity is non-skippable when required (D-CONST-7 fail-closed gate)', () => {
  const text = fs.readFileSync(workflowPath, 'utf8');
  const workflow = YAML.parse(text) as {
    jobs?: {
      'check-config'?: { outputs?: Record<string, unknown> };
      'enforce-parity-required'?: {
        if?: string;
        steps?: Array<Record<string, unknown>>;
      };
    };
  };

  // check-config must publish a `required` flag derived from the opt-in env var.
  const checkConfig = workflow.jobs?.['check-config'];
  assert.ok(checkConfig, 'check-config job must exist');
  assert.ok(
    String(checkConfig?.outputs?.required ?? '').includes('required'),
    'check-config must output a `required` flag',
  );
  assert.match(text, /CI_REQUIRE_SCHEMA_PARITY/, 'enforcement is gated on CI_REQUIRE_SCHEMA_PARITY');

  // A required parity run with no DB configured must FAIL closed, never silent-skip.
  const enforce = workflow.jobs?.['enforce-parity-required'];
  assert.ok(enforce, 'enforce-parity-required job must exist');
  assert.match(
    String(enforce?.if ?? ''),
    /db-configured.*!=.*'true'.*required.*==.*'true'/s,
    'enforcement runs only when parity is required AND the DB is unconfigured',
  );
  const failStep = (enforce?.steps ?? []).find((step) =>
    /exit 1/.test(String((step as Record<string, unknown>).run ?? '')),
  );
  assert.ok(failStep, 'enforce-parity-required must contain an `exit 1` fail-closed step');
});
