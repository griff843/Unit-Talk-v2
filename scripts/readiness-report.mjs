import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = loadEnvironment();
const now = new Date();
const thresholds = {
  ingestorStalenessWarnMin: 60,
  ingestorStalenessCritMin: 360,
  identityCoverageWarnPct: 70,
  identityCoverageCritPct: 50,
  settlementCoverageWarnPct: 70,
  clvCoverageWarnPct: 50,
  workerMaxIdleMin: 120,
};
const clvPaths = [
  'payload.clvRaw',
  'payload.clvPercent',
  'payload.beatsClosingLine',
  'payload.clv.clvRaw',
  'payload.clv.clvPercent',
  'payload.clv.beatsClosingLine',
];
const signals = [];
const criticals = [];
const warns = [];

await collect();
const overall = criticals.length > 0 ? 'RED' : warns.length > 0 ? 'YELLOW' : 'GREEN';

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ timestamp: now.toISOString(), status: overall, signals, criticals, warns, thresholds }, null, 2));
} else {
  console.log(`\nreadiness:report - ${now.toISOString().slice(0, 16).replace('T', ' ')}`);
  console.log('-'.repeat(62));
  const icons = { GREEN: '[OK]', YELLOW: '[WARN]', RED: '[FAIL]', UNKNOWN: '[?]' };
  for (const signal of signals) {
    console.log(`  ${icons[signal.status]} ${signal.name.padEnd(22)} ${signal.value}`);
    if (signal.status !== 'GREEN') console.log(`       ${signal.detail}`);
  }
  console.log(`\n${'-'.repeat(62)}`);
  if (criticals.length > 0) {
    console.log(`VERDICT: NOT READY - ${criticals.length} critical issue(s)`);
    for (const critical of criticals) console.log(`  [FAIL] ${critical}`);
  } else if (warns.length > 0) {
    console.log(`VERDICT: DEGRADED - ${warns.length} warning(s) (review before milestone gate)`);
    for (const warn of warns) console.log(`  [WARN] ${warn}`);
  } else {
    console.log('VERDICT: READY');
  }
  console.log();
}
process.exitCode = criticals.length > 0 ? 1 : 0;

async function collect() {
  const runs = await rest('/rest/v1/system_runs?select=id,status,started_at,finished_at&run_type=eq.distribution.process&order=started_at.desc&limit=5');
  const lastRun = runs[0];
  if (!lastRun) {
    signals.push({ name: 'Worker Runtime', status: 'RED', value: 'no runs', detail: 'No distribution.process system_runs found' });
    criticals.push('Worker: no distribution runs in system_runs');
  } else {
    const idle = ageMin(lastRun.started_at);
    const status = idle > thresholds.workerMaxIdleMin ? 'RED' : lastRun.status === 'failed' ? 'YELLOW' : 'GREEN';
    signals.push({ name: 'Worker Runtime', status, value: `last run ${ageFmt(lastRun.started_at)} ago (${lastRun.status})`, detail: `${runs.length} recent distribution runs; last status=${lastRun.status}` });
    if (status === 'RED') criticals.push(`Worker idle ${idle}min (>${thresholds.workerMaxIdleMin}min threshold)`);
    if (status === 'YELLOW') warns.push(`Last worker run status=${lastRun.status}`);
  }

  const outbox = await rest('/rest/v1/distribution_outbox?select=id,status,created_at,claimed_at,attempt_count');
  const dead = outbox.filter((row) => row.status === 'dead_letter');
  const stuck = outbox.filter((row) => row.status === 'processing' && row.claimed_at && ageMin(row.claimed_at) > 5);
  const pending = outbox.filter((row) => row.status === 'pending');
  signals.push({ name: 'Outbox Health', status: dead.length > 0 ? 'RED' : stuck.length > 0 ? 'YELLOW' : 'GREEN', value: `${pending.length} pending, ${dead.length} dead_letter`, detail: `${outbox.length} total rows; stuck_processing=${stuck.length}; dead_letter=${dead.length}` });
  if (dead.length > 0) criticals.push(`${dead.length} outbox rows in dead_letter`);
  if (stuck.length > 0) warns.push(`${stuck.length} outbox rows stuck processing >5min`);

  const offers = await rest('/rest/v1/provider_offers?select=id,snapshot_at,sport_key,provider_key&order=snapshot_at.desc&limit=1');
  const offer = offers[0];
  if (!offer) {
    signals.push({ name: 'Ingestor Freshness', status: 'RED', value: 'no offers', detail: 'provider_offers table is empty' });
    criticals.push('Ingestor: no provider_offers found');
  } else {
    const age = ageMin(offer.snapshot_at);
    const status = age > thresholds.ingestorStalenessCritMin ? 'RED' : age > thresholds.ingestorStalenessWarnMin ? 'YELLOW' : 'GREEN';
    signals.push({ name: 'Ingestor Freshness', status, value: `latest offer ${ageFmt(offer.snapshot_at)} ago`, detail: `sport=${offer.sport_key} provider=${offer.provider_key} snapshot_at=${offer.snapshot_at}` });
    if (status === 'RED') criticals.push(`Ingestor stale: latest offer ${age}min ago`);
    if (status === 'YELLOW') warns.push(`Ingestor: latest offer ${age}min ago (>${thresholds.ingestorStalenessWarnMin}min)`);
  }

  const picks = await rest('/rest/v1/picks?select=id,participant_id,capper_id,source&status=in.(posted,settled,qualified,held)&order=created_at.desc&limit=200');
  const participantPct = pct(picks.filter((pick) => pick.participant_id !== null).length, picks.length, 100);
  const capperPct = pct(picks.filter((pick) => pick.capper_id !== null).length, picks.length, 100);
  const identityStatus = participantPct < thresholds.identityCoverageCritPct ? 'RED' : participantPct < thresholds.identityCoverageWarnPct ? 'YELLOW' : 'GREEN';
  signals.push({ name: 'Identity Health', status: identityStatus, value: `participant_id=${participantPct}%, capper_id=${capperPct}%`, detail: `sample=${picks.length}; with_participant=${picks.filter((pick) => pick.participant_id !== null).length}; with_capper=${picks.filter((pick) => pick.capper_id !== null).length}` });
  if (identityStatus === 'RED') criticals.push(`Identity: only ${participantPct}% picks have participant_id`);
  if (identityStatus === 'YELLOW') warns.push(`Identity: ${participantPct}% participant_id coverage (threshold=${thresholds.identityCoverageWarnPct}%)`);

  const posted = await rest('/rest/v1/picks?select=id,status&status=in.(posted,settled)&order=created_at.desc&limit=500');
  const settlements = await rest('/rest/v1/settlement_records?select=id,pick_id,result,source,payload,corrects_id&corrects_id=is.null&order=created_at.desc&limit=500');
  const settledSet = new Set(settlements.map((settlement) => settlement.pick_id));
  const settledPicks = posted.filter((pick) => pick.status === 'settled');
  const settlementPct = pct(settledPicks.filter((pick) => settledSet.has(pick.id)).length, settledPicks.length, 100);
  const settlementStatus = settlementPct < thresholds.settlementCoverageWarnPct ? 'YELLOW' : 'GREEN';
  signals.push({ name: 'Settlement Coverage', status: settlementStatus, value: `${settlementPct}% settled picks have settlement_record`, detail: `posted=${posted.filter((pick) => pick.status === 'posted').length}; settled=${settledPicks.length}; with_record=${settledPicks.filter((pick) => settledSet.has(pick.id)).length}` });
  if (settlementStatus === 'YELLOW') warns.push(`Settlement: only ${settlementPct}% settled picks have a record`);

  const clv = summarizeClv(settlements);
  const clvStatus = settlements.length === 0 ? 'UNKNOWN' : clv.coveragePct < thresholds.clvCoverageWarnPct ? 'YELLOW' : 'GREEN';
  signals.push({ name: 'CLV Resolution', status: clvStatus, value: `${clv.coveragePct}% settlements have CLV data`, detail: `total_records=${clv.totalRecords}; with_clv=${clv.withClv}; payload_paths: ${clvPaths.map((key) => `${key}=${clv.pathCounts[key]}`).join(', ')}` });
  if (clvStatus === 'YELLOW') warns.push(`CLV: only ${clv.coveragePct}% settlements have CLV payload (threshold=${thresholds.clvCoverageWarnPct}%)`);

  const receipts = await rest('/rest/v1/distribution_receipts?select=id,channel,recorded_at&order=recorded_at.desc&limit=100');
  const channels = [...new Set(receipts.map((receipt) => receipt.channel).filter(Boolean))];
  signals.push({ name: 'Delivery Receipts', status: receipts.length > 0 ? 'GREEN' : 'YELLOW', value: `${receipts.length} receipts across ${channels.length} channels`, detail: `latest=${receipts.length ? ageFmt(receipts[0].recorded_at) : 'n/a'} ago; channels=[${channels.slice(0, 5).join(',')}]` });
  if (receipts.length === 0) warns.push('Delivery: no distribution_receipts found');
}

function loadEnvironment() {
  return { ...envFile('.env.example'), ...envFile('.env'), ...envFile('local.env'), ...process.env };
}

function envFile(name) {
  const filePath = path.join(ROOT, name);
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equals = trimmed.indexOf('=');
    if (equals <= 0) continue;
    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

async function rest(urlPath) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return [];
  const response = await fetch(`${env.SUPABASE_URL}${urlPath}`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!response.ok) {
    signals.push({ name: 'Supabase Query', status: 'UNKNOWN', value: `HTTP ${response.status}`, detail: `${urlPath}: ${await response.text()}` });
    return [];
  }
  return await response.json();
}

function ageMin(timestamp) {
  return Math.round((now.getTime() - new Date(timestamp).getTime()) / 60000);
}

function ageFmt(timestamp) {
  const minutes = ageMin(timestamp);
  return minutes < 60 ? `${minutes}m` : `${(minutes / 60).toFixed(1)}h`;
}

function pct(numerator, denominator, emptyValue = 0) {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : emptyValue;
}

function summarizeClv(settlements) {
  const pathCounts = Object.fromEntries(clvPaths.map((key) => [key, 0]));
  let withClv = 0;
  for (const settlement of settlements) {
    const paths = activeClvPaths(settlement);
    if (paths.length > 0) withClv += 1;
    for (const key of paths) pathCounts[key] += 1;
  }
  return { totalRecords: settlements.length, withClv, coveragePct: pct(withClv, settlements.length), pathCounts };
}

function activeClvPaths(settlement) {
  const payload = asRecord(settlement.payload);
  if (!payload) return [];
  const paths = [];
  if (Number.isFinite(payload.clvRaw)) paths.push('payload.clvRaw');
  if (Number.isFinite(payload.clvPercent)) paths.push('payload.clvPercent');
  if (typeof payload.beatsClosingLine === 'boolean') paths.push('payload.beatsClosingLine');
  const nested = asRecord(payload.clv);
  if (nested) {
    if (Number.isFinite(nested.clvRaw)) paths.push('payload.clv.clvRaw');
    if (Number.isFinite(nested.clvPercent)) paths.push('payload.clv.clvPercent');
    if (typeof nested.beatsClosingLine === 'boolean') paths.push('payload.clv.beatsClosingLine');
  }
  return paths;
}

function asRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
}
