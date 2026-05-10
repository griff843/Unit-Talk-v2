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
  assert.match(String(gateStep?.run ?? ''), /pnpm ci:schema-drift-gate --/);
  assert.match(String(gateStep?.run ?? ''), /--report artifacts\/schema-parity\/live-schema-parity\.json/);
  assert.match(String(artifactStep?.with ? (artifactStep.with as Record<string, unknown>).path : ''), /artifacts\/schema-parity\/?/);
  assert.match(text, /scripts\/ci\/schema-drift-gate\.ts/);
});
