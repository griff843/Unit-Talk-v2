import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

import {
  PRODUCTION_SCHEDULER_IDS,
  type ProductionSchedulerId,
} from '../../apps/api/src/scheduler-policy.js';

const INDEX_PATH = resolve(process.cwd(), 'apps/api/src/index.ts');
const indexSource = readFileSync(INDEX_PATH, 'utf8');
const PACKAGE_PATH = resolve(process.cwd(), 'package.json');
const packageSource = readFileSync(PACKAGE_PATH, 'utf8');

const SCHEDULED_WORK: Readonly<Record<string, ProductionSchedulerId>> = {
  startRecapScheduler: 'recap',
  startTrialExpiryScheduler: 'trial-expiry',
  runPlayerEnrichmentPass: 'participant-enrichment',
  runTeamLogoEnrichmentPass: 'participant-enrichment',
  runSystemPickScan: 'system-pick-scanner',
  runClosingLineRecovery: 'closing-line-recovery',
  runMarketUniverseMaterializer: 'market-universe-materializer',
  runLineMovementDetection: 'line-movement-detector',
  runBoardScan: 'board-scan',
  runCandidateScoring: 'candidate-scoring',
  runRankedSelection: 'ranked-selection',
  runBoardConstruction: 'board-construction',
  runBoardPickWriter: 'board-pick-writer',
  runCandidatePickScan: 'candidate-pick-scanner',
  runModelHealthScan: 'model-health-scanner',
};

function isPolicyRegistration(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === 'schedulerPolicy'
    && node.expression.name.text === 'register';
}

function registrationId(node: ts.CallExpression): string | null {
  const schedulerArgument = node.arguments[0];
  return schedulerArgument && ts.isStringLiteral(schedulerArgument)
    ? schedulerArgument.text
    : null;
}

function findOwningRegistration(node: ts.Node): string | null {
  let current: ts.Node | undefined = node;
  let child: ts.Node = node;
  while (current) {
    if (isPolicyRegistration(current)) {
      const registration = current.arguments[1];
      return registration === child ? registrationId(current) : null;
    }
    child = current;
    current = current.parent;
  }
  return null;
}

function calledFunctionName(node: ts.CallExpression): string | null {
  return ts.isIdentifier(node.expression) ? node.expression.text : null;
}

export function auditSchedulerClassifications(sourceText: string): string[] {
  const sourceFile = ts.createSourceFile(
    INDEX_PATH,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const violations: string[] = [];
  const registrationCounts = new Map<string, number>();

  function visit(node: ts.Node): void {
    if (isPolicyRegistration(node)) {
      const scheduler = registrationId(node);
      if (!scheduler) {
        violations.push('schedulerPolicy.register must use a string-literal scheduler id');
      } else {
        registrationCounts.set(scheduler, (registrationCounts.get(scheduler) ?? 0) + 1);
      }
    }

    if (ts.isCallExpression(node)) {
      const functionName = calledFunctionName(node);
      const expectedScheduler = functionName ? SCHEDULED_WORK[functionName] : undefined;
      if (expectedScheduler) {
        const owner = findOwningRegistration(node);
        if (owner !== expectedScheduler) {
          violations.push(
            `${functionName} must be owned by schedulerPolicy.register('${expectedScheduler}')`,
          );
        }
      }

      if (functionName === 'setInterval' && !findOwningRegistration(node)) {
        violations.push('every setInterval production scheduler must be owned by schedulerPolicy.register');
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  for (const scheduler of PRODUCTION_SCHEDULER_IDS) {
    const count = registrationCounts.get(scheduler) ?? 0;
    if (count !== 1) {
      violations.push(`scheduler ${scheduler} must have exactly one policy registration; found ${count}`);
    }
  }

  for (const scheduler of registrationCounts.keys()) {
    if (!PRODUCTION_SCHEDULER_IDS.includes(scheduler as ProductionSchedulerId)) {
      violations.push(`scheduler ${scheduler} is not classified in scheduler-policy.ts`);
    }
  }

  return violations;
}

export function auditSchedulerTestWiring(sourceText: string): string[] {
  const packageJson = JSON.parse(sourceText) as {
    scripts?: Record<string, string>;
  };
  const violations: string[] = [];
  const apiCoreTests = packageJson.scripts?.['test:apps-api-core'] ?? '';
  const opsTests = packageJson.scripts?.['test:ops'] ?? '';

  if (!apiCoreTests.includes('apps/api/src/scheduler-policy.test.ts')) {
    violations.push('test:apps-api-core must run scheduler-policy.test.ts');
  }
  if (!opsTests.includes('scripts/ci/scheduler-classification.test.ts')) {
    violations.push('test:ops must run scheduler-classification.test.ts');
  }
  if (!opsTests.includes('scripts/ci/deploy-parked-mode.test.ts')) {
    violations.push('test:ops must run deploy-parked-mode.test.ts');
  }

  return violations;
}

test('every API production scheduler is registered through the canonical classified policy', () => {
  assert.deepEqual(auditSchedulerClassifications(indexSource), []);
});

test('runtime policy receipt is emitted only after actual scheduler start outcomes are recorded', () => {
  const receiptIndex = indexSource.indexOf("event: 'scheduler_policy.resolved'");
  const lastRegistrationIndex = indexSource.lastIndexOf('schedulerPolicy.register(');

  assert.notEqual(receiptIndex, -1);
  assert.ok(receiptIndex > lastRegistrationIndex);
  assert.match(indexSource, /eligibilityDecisions: schedulerPolicy\.decisions/);
  assert.match(indexSource, /registrationOutcomes: schedulerPolicy\.outcomes/);
});

test('all parked-mode safety suites are wired into the canonical root test path', () => {
  assert.deepEqual(auditSchedulerTestWiring(packageSource), []);
});

for (const requiredTest of [
  'apps/api/src/scheduler-policy.test.ts',
  'scripts/ci/scheduler-classification.test.ts',
  'scripts/ci/deploy-parked-mode.test.ts',
] as const) {
  test(`required-test wiring audit detects removal of ${requiredTest}`, () => {
    assert.ok(packageSource.includes(requiredTest), `fixture must contain ${requiredTest}`);
    const mutatedSource = packageSource.replace(requiredTest, '');
    assert.ok(
      auditSchedulerTestWiring(mutatedSource).some((violation) =>
        violation.includes(requiredTest.split('/').at(-1) ?? requiredTest),
      ),
    );
  });
}

for (const scheduler of ['candidate-scoring', 'ranked-selection', 'board-construction'] as const) {
  test(`static verification detects removal of the ${scheduler} parked-mode gate`, () => {
    const originalGate = `schedulerPolicy.register('${scheduler}'`;
    assert.ok(indexSource.includes(originalGate), `fixture must contain ${originalGate}`);

    const mutatedSource = indexSource.replace(
      originalGate,
      `schedulerPolicy.uncheckedRegister('${scheduler}'`,
    );
    const violations = auditSchedulerClassifications(mutatedSource);

    assert.ok(
      violations.some((violation) => violation.includes(`scheduler ${scheduler}`)),
      violations.join('\n'),
    );
  });
}

test('static verification rejects a newly introduced unclassified interval scheduler', () => {
  const mutatedSource = `${indexSource}\nsetInterval(() => {}, 60_000);\n`;
  assert.ok(
    auditSchedulerClassifications(mutatedSource).some((violation) =>
      violation.includes('every setInterval production scheduler')),
  );
});
