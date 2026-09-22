export interface RecapEvidence {
  id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  details: Record<string, unknown>;
}
export interface RecapStatus {
  state: 'posted' | 'not-posted' | 'not-applicable' | 'unavailable';
  title: string;
  description: string;
  channel?: string;
  postedAt?: string;
  evidenceId?: string;
}
const reasons: Record<string, string> = {
  'kill-switch-engaged': 'The delivery kill switch refused the recap.',
  no_discord_bot_token: 'Discord credentials were not configured when the recap was attempted.',
  no_sent_distribution_outbox: 'No sent delivery record was available for the recap route.',
  no_receipt_channel_or_resolvable_outbox_target: 'The recorded delivery could not resolve a Discord destination.',
  recap_provenance_unavailable: 'The recap evidence store was unavailable, so no new delivery was attempted.',
};
export function summarizeRecapEvidence(records: RecapEvidence[], verifiedNoDelivery: boolean): RecapStatus {
  const ordered = [...records].sort((a, b) => b.started_at.localeCompare(a.started_at) || b.id.localeCompare(a.id));
  const posted = ordered.find((row) => row.status === 'succeeded' && row.details['posted'] === true &&
    typeof row.details['channel'] === 'string' && row.details['channel'].length > 0 && row.finished_at !== null);
  if (posted) return {
    state: 'posted', title: 'Posted', description: 'A successful recap publication is recorded for this settlement.',
    channel: String(posted.details['channel']), postedAt: posted.finished_at!, evidenceId: posted.id,
  };
  if (ordered.length === 0) return verifiedNoDelivery
    ? { state: 'not-applicable', title: 'Not applicable', description: 'No delivery record, receipt or attempt exists for this pick, so no member recap is owed.' }
    : { state: 'unavailable', title: 'Recap evidence unavailable', description: 'No per-pick outcome is recorded for this settlement. Older recap records cannot prove whether it posted; investigate delivery history before retrying.' };
  if (ordered.some((row) => row.status === 'running' || row.details['posted'] !== false ||
    !['failed', 'cancelled'].includes(row.status) || row.details['reason'] === 'recap_request_outcome_unknown' ||
    typeof row.details['reason'] !== 'string' || !row.finished_at)) return {
    state: 'unavailable', title: 'Recap outcome unresolved',
    description: 'An attempt lacks a confirmed terminal outcome. Check Discord and the delivery records before retrying to avoid a duplicate recap.',
  };
  const last = ordered[0]!;
  const reason = String(last.details['reason']);
  const description = reasons[reason] ?? (reason.startsWith('discord_post_failed_')
    ? `Discord refused the recap request (HTTP ${reason.slice('discord_post_failed_'.length)}).`
    : reason.startsWith('stake_units_') ? 'The recorded stake could not support a verified profit/loss figure, so publication was refused.'
      : `The recorded recap refusal requires investigation: ${reason}.`);
  return { state: 'not-posted', title: 'Not posted', description, evidenceId: last.id };
}
