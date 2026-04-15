// Canonical readiness report — UTV2-640
// Run with: pnpm readiness:report
// Reports M1–M4 milestone-critical truth: runtime, ingestion, grading, identity, CLV, delivery.
import { loadEnvironment } from '@unit-talk/config'
import { createClient } from '@supabase/supabase-js'

const env = loadEnvironment()
const url = env.SUPABASE_URL ?? ''
const key = env.SUPABASE_SERVICE_ROLE_KEY ?? ''
if (!url || !key) { console.error('FATAL: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }

const db = createClient(url, key, { auth: { persistSession: false } })

const args = process.argv.slice(2)
const jsonMode = args.includes('--json')

// ─── Thresholds ───────────────────────────────────────────────────────────────
const THRESHOLDS = {
  ingestorStalenessWarnMin: 60,     // warn if latest offer > 60min old
  ingestorStalenessCritMin: 360,    // critical if > 6hr old
  identityCoverageWarnPct: 70,      // warn if < 70% picks have participant_id
  identityCoverageCritPct: 50,      // critical if < 50%
  settlementCoverageWarnPct: 70,    // warn if < 70% posted picks settled
  clvCoverageWarnPct: 50,           // warn if < 50% settled picks have CLV
  workerMaxIdleMin: 120,            // critical if no distribution run in 2hr
}

type SignalStatus = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN'

interface Signal {
  name: string
  status: SignalStatus
  value: string
  detail: string
}

async function main() {
  const now = new Date()
  const signals: Signal[] = []
  const criticals: string[] = []
  const warns: string[] = []

  function ageMin(ts: string) { return Math.round((now.getTime() - new Date(ts).getTime()) / 60000) }
  function ageFmt(ts: string) { const m = ageMin(ts); return m < 60 ? `${m}m` : `${(m / 60).toFixed(1)}h` }

  // ── 1. Worker Runtime ─────────────────────────────────────────────────────
  const { data: runs, error: runsErr } = await db
    .from('system_runs')
    .select('id, status, started_at, finished_at')
    .eq('run_type', 'distribution.process')
    .order('started_at', { ascending: false })
    .limit(5)

  if (runsErr) {
    signals.push({ name: 'Worker Runtime', status: 'UNKNOWN', value: 'query failed', detail: runsErr.message })
  } else {
    const lastRun = runs?.[0]
    if (!lastRun) {
      signals.push({ name: 'Worker Runtime', status: 'RED', value: 'no runs', detail: 'No distribution.process system_runs found' })
      criticals.push('Worker: no distribution runs in system_runs')
    } else {
      const idleMin = ageMin(lastRun.started_at)
      const status: SignalStatus = idleMin > THRESHOLDS.workerMaxIdleMin ? 'RED'
        : lastRun.status === 'failed' ? 'YELLOW' : 'GREEN'
      signals.push({
        name: 'Worker Runtime',
        status,
        value: `last run ${ageFmt(lastRun.started_at)} ago (${lastRun.status})`,
        detail: `${runs?.length ?? 0} recent distribution runs; last status=${lastRun.status}`,
      })
      if (status === 'RED') criticals.push(`Worker idle ${idleMin}min (>${THRESHOLDS.workerMaxIdleMin}min threshold)`)
      if (status === 'YELLOW') warns.push(`Last worker run status=${lastRun.status}`)
    }
  }

  // ── 2. Outbox Health ──────────────────────────────────────────────────────
  const { data: outbox, error: outboxErr } = await db
    .from('distribution_outbox')
    .select('id, status, created_at, claimed_at, attempt_count')

  if (outboxErr) {
    signals.push({ name: 'Outbox Health', status: 'UNKNOWN', value: 'query failed', detail: outboxErr.message })
  } else {
    const rows = outbox ?? []
    const deadLetter = rows.filter(r => r.status === 'dead_letter')
    const stuckProc = rows.filter(r =>
      r.status === 'processing' && r.claimed_at && ageMin(r.claimed_at) > 5
    )
    const pending = rows.filter(r => r.status === 'pending')
    const status: SignalStatus = deadLetter.length > 0 ? 'RED' : stuckProc.length > 0 ? 'YELLOW' : 'GREEN'
    signals.push({
      name: 'Outbox Health',
      status,
      value: `${pending.length} pending, ${deadLetter.length} dead_letter`,
      detail: `${rows.length} total rows; stuck_processing=${stuckProc.length}; dead_letter=${deadLetter.length}`,
    })
    if (deadLetter.length > 0) criticals.push(`${deadLetter.length} outbox rows in dead_letter`)
    if (stuckProc.length > 0) warns.push(`${stuckProc.length} outbox rows stuck processing >5min`)
  }

  // ── 3. Ingestor Freshness ─────────────────────────────────────────────────
  const { data: freshOffer, error: freshErr } = await db
    .from('provider_offers')
    .select('id, snapshot_at, sport_key, provider_key')
    .order('snapshot_at', { ascending: false })
    .limit(1)
    .single()

  if (freshErr && freshErr.code !== 'PGRST116') {
    signals.push({ name: 'Ingestor Freshness', status: 'UNKNOWN', value: 'query failed', detail: freshErr.message })
  } else if (!freshOffer) {
    signals.push({ name: 'Ingestor Freshness', status: 'RED', value: 'no offers', detail: 'provider_offers table is empty' })
    criticals.push('Ingestor: no provider_offers found')
  } else {
    const ageM = ageMin(freshOffer.snapshot_at)
    const status: SignalStatus = ageM > THRESHOLDS.ingestorStalenessCritMin ? 'RED'
      : ageM > THRESHOLDS.ingestorStalenessWarnMin ? 'YELLOW' : 'GREEN'
    signals.push({
      name: 'Ingestor Freshness',
      status,
      value: `latest offer ${ageFmt(freshOffer.snapshot_at)} ago`,
      detail: `sport=${freshOffer.sport_key} provider=${freshOffer.provider_key} snapshot_at=${freshOffer.snapshot_at}`,
    })
    if (status === 'RED') criticals.push(`Ingestor stale: latest offer ${ageM}min ago`)
    if (status === 'YELLOW') warns.push(`Ingestor: latest offer ${ageM}min ago (>${THRESHOLDS.ingestorStalenessWarnMin}min)`)
  }

  // ── 4. Canonical Identity Health ─────────────────────────────────────────
  const { data: pickSample, error: pickErr } = await db
    .from('picks')
    .select('id, participant_id, capper_id, source')
    .in('status', ['posted', 'settled', 'qualified', 'held'])
    .order('created_at', { ascending: false })
    .limit(200)

  if (pickErr) {
    signals.push({ name: 'Identity Health', status: 'UNKNOWN', value: 'query failed', detail: pickErr.message })
  } else {
    const picks = pickSample ?? []
    const withParticipant = picks.filter(p => p.participant_id !== null)
    const withCapper = picks.filter(p => p.capper_id !== null)
    const participantPct = picks.length > 0 ? Math.round((withParticipant.length / picks.length) * 100) : 100
    const capperPct = picks.length > 0 ? Math.round((withCapper.length / picks.length) * 100) : 100
    const status: SignalStatus = participantPct < THRESHOLDS.identityCoverageCritPct ? 'RED'
      : participantPct < THRESHOLDS.identityCoverageWarnPct ? 'YELLOW' : 'GREEN'
    signals.push({
      name: 'Identity Health',
      status,
      value: `participant_id=${participantPct}%, capper_id=${capperPct}%`,
      detail: `sample=${picks.length}; with_participant=${withParticipant.length}; with_capper=${withCapper.length}`,
    })
    if (status === 'RED') criticals.push(`Identity: only ${participantPct}% picks have participant_id`)
    if (status === 'YELLOW') warns.push(`Identity: ${participantPct}% participant_id coverage (threshold=${THRESHOLDS.identityCoverageWarnPct}%)`)
  }

  // ── 5. Settlement Coverage ────────────────────────────────────────────────
  const { data: postedPicks, error: postedErr } = await db
    .from('picks')
    .select('id, status')
    .in('status', ['posted', 'settled'])
    .order('created_at', { ascending: false })
    .limit(500)

  const { data: settlements, error: settlErr } = await db
    .from('settlement_records')
    .select('id, pick_id, result, source, corrects_id')
    .is('corrects_id', null)
    .order('created_at', { ascending: false })
    .limit(500)

  if (postedErr || settlErr) {
    signals.push({ name: 'Settlement Coverage', status: 'UNKNOWN', value: 'query failed', detail: (postedErr ?? settlErr)?.message ?? '' })
  } else {
    const posted = postedPicks ?? []
    const settledSet = new Set((settlements ?? []).map(s => s.pick_id))
    const settledPicks = posted.filter(p => p.status === 'settled')
    const withRecord = settledPicks.filter(p => settledSet.has(p.id))
    const coveragePct = settledPicks.length > 0 ? Math.round((withRecord.length / settledPicks.length) * 100) : 100
    const status: SignalStatus = coveragePct < THRESHOLDS.settlementCoverageWarnPct ? 'YELLOW' : 'GREEN'
    signals.push({
      name: 'Settlement Coverage',
      status,
      value: `${coveragePct}% settled picks have settlement_record`,
      detail: `posted=${posted.filter(p => p.status === 'posted').length}; settled=${settledPicks.length}; with_record=${withRecord.length}`,
    })
    if (status === 'YELLOW') warns.push(`Settlement: only ${coveragePct}% settled picks have a record`)
  }

  // ── 6. CLV Resolution ─────────────────────────────────────────────────────
  const settlementsForCLV = settlements ?? []
  const withCLV = settlementsForCLV.filter(s => {
    const p = s as { payload?: Record<string, unknown> }
    return p.payload && typeof p.payload === 'object'
      && (('clvRaw' in (p.payload as Record<string, unknown>)) || ('beatsClosingLine' in (p.payload as Record<string, unknown>)))
  })
  const clvPct = settlementsForCLV.length > 0 ? Math.round((withCLV.length / settlementsForCLV.length) * 100) : 0
  {
    const status: SignalStatus = settlementsForCLV.length === 0 ? 'UNKNOWN'
      : clvPct < THRESHOLDS.clvCoverageWarnPct ? 'YELLOW' : 'GREEN'
    signals.push({
      name: 'CLV Resolution',
      status,
      value: `${clvPct}% settlements have CLV data`,
      detail: `total_records=${settlementsForCLV.length}; with_clv=${withCLV.length}`,
    })
    if (status === 'YELLOW') warns.push(`CLV: only ${clvPct}% settlements have CLV payload (threshold=${THRESHOLDS.clvCoverageWarnPct}%)`)
  }

  // ── 7. Delivery Receipts ──────────────────────────────────────────────────
  const { data: receipts, error: recErr } = await db
    .from('distribution_receipts')
    .select('id, channel, created_at')
    .order('created_at', { ascending: false })
    .limit(100)

  if (recErr) {
    signals.push({ name: 'Delivery Receipts', status: 'UNKNOWN', value: 'query failed', detail: recErr.message })
  } else {
    const recs = receipts ?? []
    const channels = [...new Set(recs.map(r => r.channel).filter(Boolean))]
    const latestAge = recs.length > 0 ? ageFmt(recs[0].created_at) : 'n/a'
    signals.push({
      name: 'Delivery Receipts',
      status: recs.length > 0 ? 'GREEN' : 'YELLOW',
      value: `${recs.length} receipts across ${channels.length} channels`,
      detail: `latest=${latestAge} ago; channels=[${channels.slice(0, 5).join(',')}]`,
    })
    if (recs.length === 0) warns.push('Delivery: no distribution_receipts found')
  }

  // ── Output ────────────────────────────────────────────────────────────────
  const overallStatus: SignalStatus = criticals.length > 0 ? 'RED' : warns.length > 0 ? 'YELLOW' : 'GREEN'

  if (jsonMode) {
    console.log(JSON.stringify({
      timestamp: now.toISOString(),
      status: overallStatus,
      signals,
      criticals,
      warns,
      thresholds: THRESHOLDS,
    }, null, 2))
    process.exit(criticals.length > 0 ? 1 : 0)
    return
  }

  const ts = now.toISOString().slice(0, 16).replace('T', ' ')
  console.log(`\nreadiness:report — ${ts}`)
  console.log('─'.repeat(62))

  const statusIcon: Record<SignalStatus, string> = { GREEN: '✅', YELLOW: '⚠ ', RED: '⛔', UNKNOWN: '?' }
  for (const sig of signals) {
    console.log(`  ${statusIcon[sig.status]} ${sig.name.padEnd(22)} ${sig.value}`)
    if (sig.status !== 'GREEN') console.log(`     ${sig.detail}`)
  }

  console.log('\n' + '─'.repeat(62))
  if (criticals.length > 0) {
    console.log(`VERDICT: NOT READY — ${criticals.length} critical issue(s)`)
    for (const c of criticals) console.log(`  ⛔ ${c}`)
  } else if (warns.length > 0) {
    console.log(`VERDICT: DEGRADED — ${warns.length} warning(s) (review before milestone gate)`)
    for (const w of warns) console.log(`  ⚠  ${w}`)
  } else {
    console.log('VERDICT: READY ✅')
  }
  console.log()
}

main().catch(e => { console.error(e); process.exit(1) })
