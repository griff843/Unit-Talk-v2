// Runtime health CLI — UTV2-641
// Run with: pnpm runtime:health
// One-command runtime truth: API, worker, scheduler, queue, provider, delivery.
// Subsystem states: HEALTHY | DEGRADED | FAILED | UNKNOWN
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
const T = {
  // Worker supervision
  workerIdleCritMin: 120,    // FAILED if no distribution run in 2hr
  workerIdleWarnMin: 30,     // DEGRADED if no distribution run in 30min
  workerFailedRunWarn: 2,    // DEGRADED if >=2 failed runs in recent window

  // Queue movement
  outboxMaxPendingWarn: 20,  // DEGRADED if >20 pending outbox rows
  outboxMaxPendingCrit: 100, // FAILED if >100 pending outbox rows
  outboxStuckProcMin: 5,     // DEGRADED if processing row claimed >5min ago
  outboxDeadLetterCrit: 1,   // FAILED on any dead_letter row

  // Provider freshness
  providerWarnMin: 60,       // DEGRADED if latest offer >60min
  providerCritMin: 360,      // FAILED if latest offer >6hr

  // Scheduler
  schedulerWarnHr: 6,        // DEGRADED if no scanner picks in 6hr
  schedulerCritHr: 24,       // FAILED if no scanner picks in 24hr

  // Delivery
  deliveryWarnHr: 4,         // DEGRADED if no delivery receipts in 4hr
  deliveryCritHr: 24,        // FAILED if no delivery receipts in 24hr
}

type SubsystemState = 'HEALTHY' | 'DEGRADED' | 'FAILED' | 'UNKNOWN'

interface Subsystem {
  name: string
  state: SubsystemState
  value: string
  detail: string
  freshness?: string  // age of most recent evidence
}

async function main() {
  const now = new Date()
  const subsystems: Subsystem[] = []
  const failed: string[] = []
  const degraded: string[] = []

  function ageMin(ts: string) { return Math.round((now.getTime() - new Date(ts).getTime()) / 60000) }
  function ageHr(ts: string) { return (now.getTime() - new Date(ts).getTime()) / 3600000 }
  function ageFmt(ts: string) {
    const m = ageMin(ts)
    return m < 60 ? `${m}m` : `${(m / 60).toFixed(1)}h`
  }

  // ── 1. Worker Supervision ─────────────────────────────────────────────────
  {
    const { data: runs, error } = await db
      .from('system_runs')
      .select('id, status, started_at, finished_at, run_type, details')
      .eq('run_type', 'distribution.process')
      .order('started_at', { ascending: false })
      .limit(10)

    if (error) {
      subsystems.push({ name: 'Worker Supervision', state: 'UNKNOWN', value: 'query failed', detail: error.message })
    } else {
      const recent = runs ?? []
      const last = recent[0]

      if (!last) {
        subsystems.push({ name: 'Worker Supervision', state: 'FAILED', value: 'no runs found', detail: 'No distribution.process runs in system_runs — worker never ran or table is empty' })
        failed.push('Worker: no distribution runs recorded')
      } else {
        const idleMin = ageMin(last.started_at)
        const recentFailed = recent.filter(r => r.status === 'failed').length
        let state: SubsystemState = 'HEALTHY'
        const issues: string[] = []

        if (idleMin > T.workerIdleCritMin) {
          state = 'FAILED'
          issues.push(`idle ${idleMin}m (>${T.workerIdleCritMin}m threshold)`)
        } else if (idleMin > T.workerIdleWarnMin || last.status === 'failed') {
          state = 'DEGRADED'
          if (idleMin > T.workerIdleWarnMin) issues.push(`idle ${idleMin}m (>${T.workerIdleWarnMin}m warn)`)
          if (last.status === 'failed') issues.push(`last run failed`)
        }
        if (recentFailed >= T.workerFailedRunWarn && state === 'HEALTHY') {
          state = 'DEGRADED'
          issues.push(`${recentFailed} failed runs in last ${recent.length}`)
        }

        subsystems.push({
          name: 'Worker Supervision',
          state,
          value: `last run ${ageFmt(last.started_at)} ago (${last.status})`,
          detail: `${recent.length} recent runs; last=${last.status}; failed_in_window=${recentFailed}; ${issues.join('; ')}`,
          freshness: ageFmt(last.started_at),
        })
        if (state === 'FAILED') failed.push(`Worker: ${issues.join(', ')}`)
        if (state === 'DEGRADED') degraded.push(`Worker: ${issues.join(', ')}`)
      }
    }
  }

  // ── 2. Queue Movement ─────────────────────────────────────────────────────
  {
    const { data: outbox, error } = await db
      .from('distribution_outbox')
      .select('id, status, created_at, claimed_at, attempt_count')

    if (error) {
      subsystems.push({ name: 'Queue Movement', state: 'UNKNOWN', value: 'query failed', detail: error.message })
    } else {
      const rows = outbox ?? []
      const pending = rows.filter(r => r.status === 'pending')
      const deadLetter = rows.filter(r => r.status === 'dead_letter')
      const stuckProc = rows.filter(r =>
        r.status === 'processing' && r.claimed_at && ageMin(r.claimed_at) > T.outboxStuckProcMin
      )
      const completed = rows.filter(r => r.status === 'completed' || r.status === 'delivered')

      let state: SubsystemState = 'HEALTHY'
      const issues: string[] = []

      if (deadLetter.length >= T.outboxDeadLetterCrit) {
        state = 'FAILED'
        issues.push(`${deadLetter.length} dead_letter rows`)
      } else if (pending.length > T.outboxMaxPendingCrit) {
        state = 'FAILED'
        issues.push(`${pending.length} pending rows (>${T.outboxMaxPendingCrit})`)
      } else if (pending.length > T.outboxMaxPendingWarn || stuckProc.length > 0) {
        state = 'DEGRADED'
        if (pending.length > T.outboxMaxPendingWarn) issues.push(`${pending.length} pending (>${T.outboxMaxPendingWarn} warn)`)
        if (stuckProc.length > 0) issues.push(`${stuckProc.length} stuck processing >5m`)
      }

      subsystems.push({
        name: 'Queue Movement',
        state,
        value: `${pending.length} pending, ${deadLetter.length} dead_letter`,
        detail: `total=${rows.length}; completed=${completed.length}; stuck=${stuckProc.length}; dead_letter=${deadLetter.length}; ${issues.join('; ')}`,
      })
      if (state === 'FAILED') failed.push(`Queue: ${issues.join(', ')}`)
      if (state === 'DEGRADED') degraded.push(`Queue: ${issues.join(', ')}`)
    }
  }

  // ── 3. Provider Freshness ─────────────────────────────────────────────────
  {
    const { data: latest, error } = await db
      .from('provider_offers')
      .select('id, snapshot_at, sport_key, provider_key')
      .order('snapshot_at', { ascending: false })
      .limit(1)
      .single()

    if (error && error.code !== 'PGRST116') {
      subsystems.push({ name: 'Provider Freshness', state: 'UNKNOWN', value: 'query failed', detail: error.message })
    } else if (!latest) {
      subsystems.push({ name: 'Provider Freshness', state: 'FAILED', value: 'no offers', detail: 'provider_offers table is empty — ingestor has never run or data was cleared' })
      failed.push('Provider: no offers in provider_offers')
    } else {
      const m = ageMin(latest.snapshot_at)
      const state: SubsystemState = m > T.providerCritMin ? 'FAILED' : m > T.providerWarnMin ? 'DEGRADED' : 'HEALTHY'

      subsystems.push({
        name: 'Provider Freshness',
        state,
        value: `latest offer ${ageFmt(latest.snapshot_at)} ago`,
        detail: `sport=${latest.sport_key}; provider=${latest.provider_key}; snapshot_at=${latest.snapshot_at}`,
        freshness: ageFmt(latest.snapshot_at),
      })
      if (state === 'FAILED') failed.push(`Provider: stale ${m}m ago (>${T.providerCritMin}m threshold)`)
      if (state === 'DEGRADED') degraded.push(`Provider: stale ${m}m ago (>${T.providerWarnMin}m warn)`)
    }
  }

  // ── 4. Scheduler Safety (pick pipeline flow) ──────────────────────────────
  {
    // Proxy: check for recently created picks from autonomous sources
    const { data: scannerPicks, error } = await db
      .from('picks')
      .select('id, created_at, source, status')
      .in('source', ['system-pick-scanner', 'alert-agent', 'model-driven'])
      .order('created_at', { ascending: false })
      .limit(10)

    if (error) {
      subsystems.push({ name: 'Scheduler Safety', state: 'UNKNOWN', value: 'query failed', detail: error.message })
    } else {
      const picks = scannerPicks ?? []
      const last = picks[0]

      if (!last) {
        // Scheduler quiesced per DEBT-003 — expected state, not a failure
        subsystems.push({
          name: 'Scheduler Safety',
          state: 'DEGRADED',
          value: 'no autonomous picks',
          detail: 'No system-pick-scanner/alert-agent/model-driven picks found. DEBT-003: scanner quiesced intentionally. Re-enable when DEBT-002 + brake proven.',
        })
        degraded.push('Scheduler: scanner quiesced (DEBT-003) — expected, monitor for re-enablement readiness')
      } else {
        const hrs = ageHr(last.created_at)
        const state: SubsystemState = hrs > T.schedulerCritHr ? 'FAILED' : hrs > T.schedulerWarnHr ? 'DEGRADED' : 'HEALTHY'
        subsystems.push({
          name: 'Scheduler Safety',
          state,
          value: `last autonomous pick ${ageFmt(last.created_at)} ago`,
          detail: `source=${last.source}; status=${last.status}; ${picks.length} recent scanner picks`,
          freshness: ageFmt(last.created_at),
        })
        if (state === 'FAILED') failed.push(`Scheduler: no autonomous picks for ${hrs.toFixed(1)}h (>${T.schedulerCritHr}h threshold)`)
        if (state === 'DEGRADED') degraded.push(`Scheduler: last autonomous pick ${hrs.toFixed(1)}h ago`)
      }
    }
  }

  // ── 5. Discord Delivery Posture ───────────────────────────────────────────
  {
    const { data: receipts, error } = await db
      .from('distribution_receipts')
      .select('id, channel, status, recorded_at, outbox_id')
      .order('recorded_at', { ascending: false })
      .limit(50)

    if (error) {
      subsystems.push({ name: 'Discord Delivery', state: 'UNKNOWN', value: 'query failed', detail: error.message })
    } else {
      const recs = receipts ?? []
      const last = recs[0]
      const channels = [...new Set(recs.map(r => r.channel).filter(Boolean))]
      const failed_deliveries = recs.filter(r => r.status === 'failed').length

      if (!last) {
        subsystems.push({
          name: 'Discord Delivery',
          state: 'DEGRADED',
          value: 'no receipts',
          detail: 'No distribution_receipts found — no picks have been delivered',
        })
        degraded.push('Delivery: no distribution_receipts found')
      } else {
        const hrs = ageHr(last.recorded_at)
        let state: SubsystemState = 'HEALTHY'
        const issues: string[] = []

        if (hrs > T.deliveryCritHr) {
          state = 'FAILED'
          issues.push(`no delivery in ${hrs.toFixed(1)}h (>${T.deliveryCritHr}h)`)
        } else if (hrs > T.deliveryWarnHr) {
          state = 'DEGRADED'
          issues.push(`no delivery in ${hrs.toFixed(1)}h (>${T.deliveryWarnHr}h warn)`)
        }
        if (failed_deliveries > 0) {
          if (state === 'HEALTHY') state = 'DEGRADED'
          issues.push(`${failed_deliveries} failed deliveries in sample`)
        }

        subsystems.push({
          name: 'Discord Delivery',
          state,
          value: `${recs.length} receipts, last ${ageFmt(last.recorded_at)} ago`,
          detail: `channels=[${channels.slice(0, 5).join(',')}]; failed=${failed_deliveries}; ${issues.join('; ')}`,
          freshness: ageFmt(last.recorded_at),
        })
        if (state === 'FAILED') failed.push(`Delivery: ${issues.join(', ')}`)
        if (state === 'DEGRADED') degraded.push(`Delivery: ${issues.join(', ')}`)
      }
    }
  }

  // ── 6. API Activity ───────────────────────────────────────────────────────
  {
    // Proxy for API health: recent picks created via non-autonomous sources (manual, capper)
    const { data: recentPicks, error } = await db
      .from('picks')
      .select('id, created_at, source, status')
      .not('source', 'in', '("system-pick-scanner","alert-agent","model-driven")')
      .order('created_at', { ascending: false })
      .limit(5)

    if (error) {
      subsystems.push({ name: 'API Activity', state: 'UNKNOWN', value: 'query failed', detail: error.message })
    } else {
      const picks = recentPicks ?? []
      const last = picks[0]

      if (!last) {
        subsystems.push({
          name: 'API Activity',
          state: 'UNKNOWN',
          value: 'no manual picks',
          detail: 'No non-autonomous picks in picks table — cannot verify API submission path',
        })
      } else {
        const hrs = ageHr(last.created_at)
        // API activity is informational — we warn if very stale but don't fail on it
        // since picks may legitimately not be flowing
        const state: SubsystemState = hrs > 48 ? 'DEGRADED' : 'HEALTHY'
        subsystems.push({
          name: 'API Activity',
          state,
          value: `last pick ${ageFmt(last.created_at)} ago (${last.source})`,
          detail: `${picks.length} recent non-autonomous picks; last source=${last.source}; status=${last.status}`,
          freshness: ageFmt(last.created_at),
        })
        if (state === 'DEGRADED') degraded.push(`API: last pick submission ${hrs.toFixed(1)}h ago`)
      }
    }
  }

  // ── Output ─────────────────────────────────────────────────────────────────
  const RED = '\x1b[31m', YELLOW = '\x1b[33m', GREEN = '\x1b[32m', CYAN = '\x1b[36m', RESET = '\x1b[0m', BOLD = '\x1b[1m', DIM = '\x1b[2m'

  const overallFailed = failed.length > 0
  const overallDegraded = !overallFailed && degraded.length > 0
  const overallState = overallFailed ? 'FAILED' : overallDegraded ? 'DEGRADED' : 'HEALTHY'

  if (jsonMode) {
    console.log(JSON.stringify({
      timestamp: now.toISOString(),
      state: overallState,
      subsystems,
      failed,
      degraded,
      thresholds: T,
    }, null, 2))
    process.exit(failed.length > 0 ? 1 : 0)
    return
  }

  const stateColor = (s: SubsystemState) => s === 'FAILED' ? RED : s === 'DEGRADED' ? YELLOW : s === 'HEALTHY' ? GREEN : CYAN
  const stateIcon  = (s: SubsystemState) => s === 'FAILED' ? '✗' : s === 'DEGRADED' ? '⚠' : s === 'HEALTHY' ? '✓' : '?'

  console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════════════════╗${RESET}`)
  console.log(`${BOLD}${CYAN}║            RUNTIME HEALTH REPORT                     ║${RESET}`)
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════════╝${RESET}`)
  console.log(`  ${DIM}${now.toISOString()}${RESET}\n`)

  for (const sub of subsystems) {
    const color = stateColor(sub.state)
    const icon = stateIcon(sub.state)
    const pad = sub.name.padEnd(22)
    console.log(`  ${color}${BOLD}${icon} ${pad}${RESET}  ${sub.value}`)
    if (sub.state !== 'HEALTHY') {
      console.log(`    ${DIM}${sub.detail}${RESET}`)
    }
  }

  console.log()
  const verdictColor = overallFailed ? RED : overallDegraded ? YELLOW : GREEN
  const verdict = overallFailed ? `FAILED — ${failed.length} subsystem(s) down` : overallDegraded ? `DEGRADED — ${degraded.length} warning(s)` : 'HEALTHY'
  console.log(`${verdictColor}${BOLD}  ● RUNTIME: ${verdict}${RESET}`)

  if (failed.length > 0) {
    console.log(`\n${RED}  FAILED:${RESET}`)
    failed.forEach(f => console.log(`    ${RED}✗ ${f}${RESET}`))
  }
  if (degraded.length > 0) {
    console.log(`\n${YELLOW}  DEGRADED:${RESET}`)
    degraded.forEach(d => console.log(`    ${YELLOW}⚠ ${d}${RESET}`))
  }

  console.log()
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
