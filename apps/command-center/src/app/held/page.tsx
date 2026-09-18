import { redirect } from 'next/navigation';

/**
 * Legacy surface absorbed by the v2 IA — see UTV2-1522 diff summary.
 *
 * The target is the approvals cockpit, not `/review`. `/review` excludes held picks
 * by construction (`getReviewQueue` applies `.or('review_decision.is.null,review_decision.neq.hold')`), so the
 * previous redirect sent an operator looking for held picks to the one page that
 * structurally cannot contain them. `/operations/approvals` merges the held queue
 * with awaiting_approval and review.
 */
export default function LegacyRedirect() {
  redirect('/operations/approvals');
}
