import micromatch from 'micromatch';

export interface ScopeEvaluation {
  forbidden: string[];
  outOfScope: string[];
  collateral: string[];
  acknowledgedUntracked: string[];
}

export function evaluateScope(
  changedFiles: string[],
  untrackedFiles: string[],
  allowedFiles: string[],
  forbiddenFiles: string[],
  expectedCollateral: string[],
  ackUntrackedReason: string | null,
): ScopeEvaluation {
  const forbidden: string[] = [];
  const outOfScope: string[] = [];
  const collateral: string[] = [];
  const acknowledgedUntracked: string[] = [];

  for (const file of changedFiles) {
    if (micromatch.isMatch(file, forbiddenFiles, { dot: true })) {
      forbidden.push(file);
      continue;
    }
    if (micromatch.isMatch(file, allowedFiles, { dot: true })) {
      continue;
    }
    if (micromatch.isMatch(file, expectedCollateral, { dot: true })) {
      collateral.push(file);
      continue;
    }
    if (untrackedFiles.includes(file) && ackUntrackedReason) {
      acknowledgedUntracked.push(file);
      continue;
    }
    outOfScope.push(file);
  }

  return { forbidden, outOfScope, collateral, acknowledgedUntracked };
}
