#!/usr/bin/env bash
# Apply branch protection on main with the P0 Protocol required check.
# Idempotent — safe to re-run.
#
# Spec: docs/05_operations/P0_PROTOCOL_SPEC.md
# Linear: UTV2-948
#
# Required: gh CLI authenticated with admin access to griff843/Unit-Talk-v2.
#
# Usage:
#   bash scripts/ops/apply-branch-protection.sh          # apply
#   bash scripts/ops/apply-branch-protection.sh --check  # print current state

set -euo pipefail

REPO="${BRANCH_PROTECTION_REPO:-griff843/Unit-Talk-v2}"
BRANCH="${BRANCH_PROTECTION_BRANCH:-main}"

if [ "${1:-}" = "--check" ]; then
  gh api "repos/${REPO}/branches/${BRANCH}/protection" --jq '{
    required_checks: .required_status_checks.contexts,
    strict: .required_status_checks.strict,
    enforce_admins: .enforce_admins.enabled,
    allow_force_pushes: .allow_force_pushes.enabled
  }'
  exit 0
fi

echo "Applying branch protection to ${REPO}:${BRANCH}..."

# Update required status checks to include P0 Protocol alongside the existing trio.
gh api -X PATCH "repos/${REPO}/branches/${BRANCH}/protection/required_status_checks" \
  -f strict=true \
  -f 'contexts[]=verify' \
  -f 'contexts[]=Executor Result Validation' \
  -f 'contexts[]=Merge Gate' \
  -f 'contexts[]=P0 Protocol'

echo "Branch protection updated. Verify with:"
echo "  bash scripts/ops/apply-branch-protection.sh --check"
