import type {
  QAExpectationResult,
  QAPreflightResult,
  QAStatus,
  SelectorContract,
  SelectorResult,
} from './types.js';
import type { Page } from 'playwright';

export function calculateFinalVerdict(input: {
  stepStatus: QAStatus;
  preflightResults: QAPreflightResult[];
  expectationResults: QAExpectationResult[];
  force?: boolean;
}): { status: QAStatus; reason: string } {
  const requiredPreflightFailures = input.preflightResults.filter((result) => (
    result.required && result.status === 'failed'
  ));
  if (requiredPreflightFailures.length > 0 && !input.force) {
    return {
      status: 'SKIP',
      reason: `Required preflight failed: ${requiredPreflightFailures.map((r) => r.id).join(', ')}.`,
    };
  }

  const criticalFailures = input.expectationResults.filter((result) => (
    result.status === 'failed' && result.severity === 'critical'
  ));
  const hardFailures = input.expectationResults.filter((result) => (
    result.status === 'failed' && result.hard
  ));
  if (criticalFailures.length > 0 || hardFailures.length > 0) {
    const failedIds = [...criticalFailures, ...hardFailures].map((r) => r.id);
    return {
      status: 'FAIL',
      reason: `Hard expectation failed: ${[...new Set(failedIds)].join(', ')}.`,
    };
  }

  if (input.stepStatus === 'FAIL' || input.stepStatus === 'ERROR') {
    return {
      status: input.stepStatus,
      reason: `Browser steps finished with ${input.stepStatus}.`,
    };
  }

  const highFailures = input.expectationResults.filter((result) => (
    result.status === 'failed' && result.severity === 'high'
  ));
  const otherExpectationFailures = input.expectationResults.filter((result) => (
    result.status === 'failed'
  ));
  if (
    requiredPreflightFailures.length > 0 ||
    highFailures.length > 0 ||
    otherExpectationFailures.length > 0 ||
    input.stepStatus === 'NEEDS_REVIEW'
  ) {
    return {
      status: 'NEEDS_REVIEW',
      reason: `Review needed for ${[...requiredPreflightFailures, ...otherExpectationFailures].map((r) => r.id).join(', ') || 'skill observations'}.`,
    };
  }

  if (input.stepStatus === 'SKIP') {
    return {
      status: 'SKIP',
      reason: 'Skill steps were skipped.',
    };
  }

  return {
    status: 'PASS',
    reason: 'Browser steps passed and required expectations passed.',
  };
}

export async function evaluateSelectorContracts(
  page: Page,
  contracts: Record<string, SelectorContract> | undefined,
): Promise<SelectorResult[]> {
  const results: SelectorResult[] = [];
  for (const [key, contract] of Object.entries(contracts ?? {})) {
    const preferredFound = await page.locator(contract.preferred).first().isVisible().catch(() => false);
    if (preferredFound) {
      results.push({
        key,
        preferred: contract.preferred,
        preferredFound: true,
        found: true,
      });
      continue;
    }

    let fallbackUsed: string | undefined;
    for (const fallback of contract.fallbacks) {
      if (await page.locator(fallback).first().isVisible().catch(() => false)) {
        fallbackUsed = fallback;
        break;
      }
    }

    results.push({
      key,
      preferred: contract.preferred,
      preferredFound: false,
      fallbackUsed,
      found: Boolean(fallbackUsed),
      recommendation: fallbackUsed
        ? `Add stable selector ${contract.preferred} for ${key}; fallback ${fallbackUsed} worked.`
        : `Add stable selector ${contract.preferred} for ${key}; no fallback rendered.`,
    });
  }
  return results;
}

export function selectorRecommendations(results: SelectorResult[]): string[] {
  return results
    .filter((result) => result.recommendation && result.found && !result.preferredFound)
    .map((result) => result.recommendation as string);
}
