// Pipeline health check — run with: tsx scripts/pipeline-health.ts
// @ts-nocheck
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL ?? ''
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
if (!url || !key) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }

const db = createClient(url, key, { auth: { persistSession: false } })

async function main() {
const now = new Date()

function ageMin(ts: string) { return Math.round((now.getTime() - new Date(ts).getTime()) / 60000) }
function ageFmt(ts: string) { const m = ageMin(ts); return m < 60 ? `${m}m` : `${Math.round(m/60*10)/10}h` }

// ── 1. Outbox queue state ─────────────────────────────────────────────────
const { data: outbox, error: outboxErr } = await db
  .from('distribution_outbox')
  .select('id, status, target, created_at, claimed_at, pick_id, attempt_count')

if (outboxErr) { console.error('outbox query failed:', outboxErr.message); process.exit(1) }

const rows = outbox ?? []
const counts: Record<string, number> = {}
for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1

console.log('\n╔══ OUTBOX QUEUE STATE ══════════════════════════════════════')
for (const [status, count] of Object.entries(counts)) {
  console.log(`  ${status.padEnd(12)} ${count}`)
}
if (!Object.keys(counts).length) console.log('  (empty)')

// ── 2. Stuck rows ─────────────────────────────────────────────────────────
const stuckProc = rows.filter(r =>
  r.status === 'processing' && r.claimed_at &&
  ageMin(r.claimed_at) > 5
)
const stuckPend = rows.filter(r => r.status === 'pending' && ageMin(r.created_at) > 30)

console.log('\n╔══ STUCK ROWS ═══════════════════════════════════════════════')
console.log(`  Processing >5min:  ${stuckProc.length === 0 ? 'NONE' : stuckProc.map(r => r.id.slice(0,8)).join(', ')}`)
console.log(`  Pending >30min:    ${stuckPend.length === 0 ? 'NONE' : stuckPend.length + ' rows, oldest=' + ageFmt(stuckPend.sort((a,b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0].created_at)}`)

// ── 3. Dead-letter & failed ───────────────────────────────────────────────
const deadLetter = rows.filter(r => r.status === 'dead_letter')
const failed = rows.filter(r => r.status === 'failed')

console.log('\n╔══ DEAD LETTER & FAILED ═════════════════════════════════════')
if (deadLetter.length === 0) {
  console.log('  Dead letter: NONE')
} else {
  for (const r of deadLetter)
    console.log(`  DEAD_LETTER id=${r.id.slice(0,8)} target=${r.target} pick=${r.pick_id?.slice(0,8)} attempts=${r.attempt_count} age=${ageFmt(r.created_at)}`)
}

if (failed.length === 0) {
  console.log('  Failed: NONE')
} else {
  for (const r of failed) {
    const { data: rec } = await db.from('distribution_receipts').select('id').eq('outbox_id', r.id).limit(1)
    const conflict = rec?.length ? ' *** CONFLICTED (receipt exists) ***' : ''
    console.log(`  FAILED id=${r.id.slice(0,8)} target=${r.target} attempts=${r.attempt_count} age=${ageFmt(r.created_at)}${conflict}`)
  }
}

// ── 4+5. System runs / worker liveness ────────────────────────────────────
const { data: runs } = await db
  .from('system_runs')
  .select('id, status, started_at, finished_at, run_type')
  .eq('run_type', 'distribution.process')
  .order('started_at', { ascending: false })
  .limit(10)

console.log('\n╔══ WORKER / SYSTEM RUNS (last 10 distribution) ═════════════')
let lastSuccessAge: number | null = null
for (const r of runs ?? []) {
  const age = ageFmt(r.started_at)
  const finAt = r.finished_at ? new Date(r.finished_at) : null
  const startAt = new Date(r.started_at)
  const dur = finAt ? Math.round((finAt.getTime() - startAt.getTime()) / 1000) + 's' : 'RUNNING'
  const clockAnomaly = finAt && finAt < startAt ? ' ⚠ CLOCK_ANOMALY' : ''
  console.log(`  [${r.status.padEnd(10)}] ${age} ago  dur=${dur}${clockAnomaly}`)
  if (r.status === 'succeeded' && lastSuccessAge === null) lastSuccessAge = ageMin(r.started_at)
}
if (!runs?.length) console.log('  (no distribution runs found)')

const runsInWindow = (runs ?? []).filter(r => ageMin(r.started_at) <= 120)
const stuckRunning = (runs ?? []).filter(r => r.status === 'running' && !r.finished_at && ageMin(r.started_at) > 5)
const lastRun = runs?.[0]
console.log(`  Runs in 120min window: ${runsInWindow.length}`)
console.log(`  Last run status: ${lastRun?.status ?? 'NONE'}`)
console.log(`  Stuck running (>5min): ${stuckRunning.length === 0 ? 'NONE' : stuckRunning.length}`)
console.log(`  Last successful run: ${lastSuccessAge !== null ? lastSuccessAge + 'm ago' : 'NONE in last 10'}`)

// Worker verdict
let workerVerdict = 'HEALTHY'
if (!lastRun) workerVerdict = 'DOWN — no runs found'
else if (lastRun.status === 'failed') workerVerdict = 'DEGRADED — last run failed'
else if (lastRun.status === 'cancelled') workerVerdict = 'DEGRADED — last run cancelled'
else if (stuckRunning.length > 0) workerVerdict = 'DEGRADED — stuck running row'
else if (runsInWindow.length === 0) workerVerdict = 'DOWN — no runs in 2hr window'
console.log(`  Worker verdict: ${workerVerdict}`)

// ── 6. Backlog age ────────────────────────────────────────────────────────
const pending = rows.filter(r => r.status === 'pending')
const oldestPending = pending.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0]

console.log('\n╔══ BACKLOG AGE ══════════════════════════════════════════════')
if (oldestPending) {
  const age = ageMin(oldestPending.created_at)
  const flag = age > 120 ? ' ⛔ CRITICAL' : age > 30 ? ' ⚠ WARN' : ' OK'
  console.log(`  Oldest pending: ${ageFmt(oldestPending.created_at)} ago${flag}`)
} else {
  console.log('  No pending rows')
}

// ── 7. Delivery truth (last 5 sent rows) ──────────────────────────────────
const sent = rows.filter(r => r.status === 'sent')
  .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  .slice(0, 5)

console.log('\n╔══ DELIVERY TRUTH (last 5 sent) ════════════════════════════')
if (sent.length === 0) {
  console.log('  No sent rows')
} else {
  for (const row of sent) {
    const { data: rec } = await db.from('distribution_receipts').select('channel').eq('outbox_id', row.id).limit(1)
    const { data: pick } = await db.from('picks').select('status').eq('id', row.pick_id).limit(1)
    const { data: lc } = await db.from('pick_lifecycle').select('id').eq('pick_id', row.pick_id).eq('to_state', 'posted').limit(1)
    const hasRec = !!rec?.length
    const lcPosted = !!lc?.length
    const pickStatus = pick?.[0]?.status ?? 'MISSING'
    const channel = rec?.[0]?.channel ?? 'ABSENT'
    const partial = (!hasRec || !lcPosted || pickStatus !== 'posted') ? ' ⚠ PARTIAL' : ' ✓'
    console.log(`  pick=${row.pick_id.slice(0,8)} status=${pickStatus} lc_posted=${lcPosted} receipt=${hasRec} channel=${channel}${partial}`)
  }
}

// ── 8. Authorized delivery targets ─────────────────────────────────────
// Receipts store raw Discord channel IDs — validate against known live channel IDs
const LIVE_CHANNEL_IDS = ['1296531122234327100', '1288613037539852329', '1356613995175481405'] // canary, best-bets, trader-insights
const { data: allRecCh } = await db.from('distribution_receipts').select('id, channel').limit(100)

console.log('\n╔══ AUTHORITY BOUNDARY ═══════════════════════════════════════')
const badChannels = (allRecCh ?? []).filter(r => {
  if (!r.channel) return true
  return !LIVE_CHANNEL_IDS.some(id => r.channel.includes(id))
})
if (badChannels.length) {
  console.log(`  ⚠  ${badChannels.length} receipts with non-live channel IDs (may be historical pre-activation records):`)
  for (const r of badChannels.slice(0, 5)) console.log(`    receipt ${r.id.slice(0,8)} channel=${r.channel}`)
} else {
  console.log('  All receipts on live channel IDs: CLEAN')
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log('\n╔══ VERDICT ══════════════════════════════════════════════════')
const warns: string[] = []
const criticals: string[] = []
if (deadLetter.length > 0) criticals.push(`${deadLetter.length} dead_letter rows`)
if (failed.length > 0) warns.push(`${failed.length} failed rows`)
if (stuckProc.length > 0) criticals.push(`${stuckProc.length} stuck processing rows`)
if (stuckPend.length > 0) warns.push(`${stuckPend.length} pending rows stuck >30min`)
if (badChannels.length) warns.push(`${badChannels.length} receipt(s) with non-live channel IDs (historical pre-activation records)`)
if (workerVerdict !== 'HEALTHY') (workerVerdict.startsWith('DOWN') ? criticals : warns).push(workerVerdict)

if (criticals.length > 0) {
  console.log(`  CRITICAL (${criticals.length}):`)
  for (const c of criticals) console.log(`    ⛔ ${c}`)
}
if (warns.length > 0) {
  console.log(`  WARN (${warns.length}):`)
  for (const w of warns) console.log(`    ⚠  ${w}`)
}
if (criticals.length === 0 && warns.length === 0) {
  console.log('  ✅ HEALTHY — no issues found')
}
console.log()
} // end main

main().catch(e => { console.error(e); process.exit(1) })
