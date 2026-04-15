// Scoring provenance and CLV coverage CLI — UTV2-642
// Run with: pnpm scoring:coverage
// Reports score provenance mix, market-backed share, CLV coverage, auto-grade coverage.
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
  marketBackedShareWarnPct: 30,       // warn if < 30% picks have any promotion score
  clvCoverageWarnPct: 40,             // warn if < 40% settled picks have CLV outcome
  clvCoverageCritPct: 20,             // critical if < 20%
  autoGradeShareWarnPct: 50,          // warn if < 50% settlements are auto-graded
  minSampleForThreshold: 10,          // skip threshold enforcement if sample < this
}

type SignalStatus = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN'

interface Signal {
  name: string
  status: SignalStatus
  value: string
  detail: string
  breakdown?: Record<string, unknown>
}

async function main() {
  const now = new Date()
  const signals: Signal[] = []
  const criticals: string[] = []
  const warns: string[] = []

  // ── 1. Score Provenance Mix ───────────────────────────────────────────────
  // Use pick_promotion_history — payload contains score breakdown from the promotion engine
  const { data: promoHistory, error: promoErr } = await db
    .from('pick_promotion_history')
    .select('id, pick_id, score, status, target, payload, version, decided_at')
    .order('decided_at', { ascending: false })
    .limit(500)

  if (promoErr) {
    signals.push({ name: 'Score Provenance', status: 'UNKNOWN', value: 'query failed', detail: promoErr.message })
  } else {
    const rows = promoHistory ?? []
    const withScore = rows.filter(r => r.score !== null)
    const byTarget: Record<string, number> = {}
    const byVersion: Record<string, number> = {}
    for (const r of rows) {
      byTarget[r.target] = (byTarget[r.target] || 0) + 1
      if (r.version) byVersion[r.version] = (byVersion[r.version] || 0) + 1
    }

    // Probe payload for score breakdown keys
    const sampleWithPayload = rows.filter(r => r.payload && typeof r.payload === 'object').slice(0, 5)
    const payloadKeys = new Set<string>()
    for (const r of sampleWithPayload) {
      const payload = r.payload as Record<string, unknown>
      for (const k of Object.keys(payload)) payloadKeys.add(k)
    }

    signals.push({
      name: 'Score Provenance',
      status: 'GREEN',
      value: `${rows.length} promo decisions; ${withScore.length} with score`,
      detail: `targets=[${Object.keys(byTarget).join(',')}]; versions=[${Object.keys(byVersion).join(',')}]`,
      breakdown: { byTarget, byVersion, payloadKeys: [...payloadKeys] },
    })
  }

  // ── 2. Market-backed Share ────────────────────────────────────────────────
  // Picks with a non-null promotion_score are market-informed (scored by promotion engine)
  const { data: pickSample, error: pickErr } = await db
    .from('picks')
    .select('id, status, promotion_score, promotion_status, sport_id, market_type_id, source')
    .in('status', ['posted', 'settled', 'qualified'])
    .order('created_at', { ascending: false })
    .limit(500)

  if (pickErr) {
    signals.push({ name: 'Market-backed Share', status: 'UNKNOWN', value: 'query failed', detail: pickErr.message })
  } else {
    const picks = pickSample ?? []
    const withScore = picks.filter(p => p.promotion_score !== null)
    const marketBacked = picks.filter(p =>
      p.promotion_score !== null && typeof p.promotion_score === 'number' && (p.promotion_score as number) > 0
    )

    const sharePct = picks.length >= THRESHOLDS.minSampleForThreshold
      ? Math.round((marketBacked.length / picks.length) * 100) : -1

    // Break down by source
    const bySrc: Record<string, number> = {}
    const srcScored: Record<string, number> = {}
    for (const p of picks) {
      const s = p.source ?? 'unknown'
      bySrc[s] = (bySrc[s] || 0) + 1
      if (p.promotion_score !== null) srcScored[s] = (srcScored[s] || 0) + 1
    }

    // Break down by sport
    const bySport: Record<string, number> = {}
    for (const p of picks) {
      const sp = p.sport_id ?? 'unknown'
      bySport[sp] = (bySport[sp] || 0) + 1
    }

    const status: SignalStatus = sharePct < 0 ? 'UNKNOWN'
      : sharePct < THRESHOLDS.marketBackedShareWarnPct ? 'YELLOW' : 'GREEN'

    signals.push({
      name: 'Market-backed Share',
      status,
      value: sharePct >= 0 ? `${sharePct}% picks market-backed` : `sample too small (${picks.length})`,
      detail: `sample=${picks.length}; with_score=${withScore.length}; market_backed=${marketBacked.length}`,
      breakdown: { bySrc, srcScored, bySport },
    })
    if (status === 'YELLOW') warns.push(`Market-backed: only ${sharePct}% picks scored (threshold=${THRESHOLDS.marketBackedShareWarnPct}%)`)
  }

  // ── 3. CLV Coverage ───────────────────────────────────────────────────────
  const { data: settlements, error: settlErr } = await db
    .from('settlement_records')
    .select('id, pick_id, result, source, payload, created_at')
    .is('corrects_id', null)
    .order('created_at', { ascending: false })
    .limit(500)

  if (settlErr) {
    signals.push({ name: 'CLV Coverage', status: 'UNKNOWN', value: 'query failed', detail: settlErr.message })
  } else {
    const recs = settlements ?? []
    const withCLV = recs.filter(s => {
      if (!s.payload || typeof s.payload !== 'object') return false
      const p = s.payload as Record<string, unknown>
      return 'clvRaw' in p || 'beatsClosingLine' in p || 'clv' in p
    })
    const beats = withCLV.filter(s => {
      const p = s.payload as Record<string, unknown>
      return p.beatsClosingLine === true || (typeof p.clvRaw === 'number' && (p.clvRaw as number) > 0)
    })
    const clvPct = recs.length >= THRESHOLDS.minSampleForThreshold
      ? Math.round((withCLV.length / recs.length) * 100) : -1
    const beatsPct = withCLV.length > 0 ? Math.round((beats.length / withCLV.length) * 100) : 0

    const status: SignalStatus = clvPct < 0 ? 'UNKNOWN'
      : clvPct < THRESHOLDS.clvCoverageCritPct ? 'RED'
      : clvPct < THRESHOLDS.clvCoverageWarnPct ? 'YELLOW' : 'GREEN'

    signals.push({
      name: 'CLV Coverage',
      status,
      value: clvPct >= 0 ? `${clvPct}% settlements have CLV; ${beatsPct}% beat closing line` : `sample too small (${recs.length})`,
      detail: `total_records=${recs.length}; with_clv=${withCLV.length}; beats_closing=${beats.length}`,
    })
    if (status === 'RED') criticals.push(`CLV: only ${clvPct}% settled picks have CLV data`)
    if (status === 'YELLOW') warns.push(`CLV: ${clvPct}% coverage (threshold=${THRESHOLDS.clvCoverageWarnPct}%)`)
  }

  // ── 4. Auto-grade Coverage ────────────────────────────────────────────────
  const settlementsData = settlements ?? []
  if (settlementsData.length > 0) {
    const bySrc: Record<string, number> = {}
    for (const s of settlementsData) {
      const src = s.source ?? 'unknown'
      bySrc[src] = (bySrc[src] || 0) + 1
    }
    const autoSources = ['auto', 'system', 'sgo', 'auto-sgo', 'automated']
    const autoCount = Object.entries(bySrc)
      .filter(([k]) => autoSources.some(a => k.toLowerCase().includes(a)))
      .reduce((sum, [, v]) => sum + v, 0)
    const autoPct = Math.round((autoCount / settlementsData.length) * 100)
    const status: SignalStatus = autoPct < THRESHOLDS.autoGradeShareWarnPct ? 'YELLOW' : 'GREEN'
    signals.push({
      name: 'Auto-grade Coverage',
      status,
      value: `${autoPct}% settlements auto-graded`,
      detail: `total=${settlementsData.length}; by source: ${Object.entries(bySrc).map(([k,v])=>`${k}=${v}`).join(', ')}`,
      breakdown: bySrc,
    })
    if (status === 'YELLOW') warns.push(`Auto-grade: only ${autoPct}% auto (threshold=${THRESHOLDS.autoGradeShareWarnPct}%)`)
  } else {
    signals.push({ name: 'Auto-grade Coverage', status: 'UNKNOWN', value: 'no settlement records', detail: 'Cannot assess' })
  }

  // ── 5. Failure Modes by Slice ─────────────────────────────────────────────
  // Picks that are 'held', 'disqualified', or 'exception' — why can't they resolve?
  const { data: heldPicks, error: heldErr } = await db
    .from('picks')
    .select('id, status, sport_id, source, market_type_id, promotion_status')
    .in('status', ['held', 'disqualified', 'exception'])
    .order('created_at', { ascending: false })
    .limit(200)

  if (!heldErr && heldPicks && heldPicks.length > 0) {
    const byStatus: Record<string, number> = {}
    const bySport: Record<string, number> = {}
    const byPromotionStatus: Record<string, number> = {}
    for (const p of heldPicks) {
      byStatus[p.status] = (byStatus[p.status] || 0) + 1
      const sp = p.sport_id ?? 'unknown'
      bySport[sp] = (bySport[sp] || 0) + 1
      const ps = p.promotion_status ?? 'unknown'
      byPromotionStatus[ps] = (byPromotionStatus[ps] || 0) + 1
    }
    signals.push({
      name: 'Blocked Picks',
      status: 'YELLOW',
      value: `${heldPicks.length} picks in held/disqualified/exception`,
      detail: `by_status: ${Object.entries(byStatus).map(([k,v])=>`${k}=${v}`).join(', ')}`,
      breakdown: { byStatus, bySport, byPromotionStatus },
    })
    warns.push(`${heldPicks.length} picks blocked (held/disqualified/exception)`)
  } else {
    signals.push({ name: 'Blocked Picks', status: 'GREEN', value: 'no blocked picks', detail: 'No held/disqualified/exception picks found' })
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
  console.log(`\nscoring:coverage — ${ts}`)
  console.log('─'.repeat(62))

  const statusIcon: Record<SignalStatus, string> = { GREEN: '✅', YELLOW: '⚠ ', RED: '⛔', UNKNOWN: '?' }
  for (const sig of signals) {
    console.log(`  ${statusIcon[sig.status]} ${sig.name.padEnd(22)} ${sig.value}`)
    if (sig.status !== 'GREEN') {
      console.log(`     detail: ${sig.detail}`)
      if (sig.breakdown) {
        console.log(`     breakdown: ${JSON.stringify(sig.breakdown)}`)
      }
    }
  }

  console.log('\n' + '─'.repeat(62))
  if (criticals.length > 0) {
    console.log(`VERDICT: NOT READY — ${criticals.length} critical issue(s)`)
    for (const c of criticals) console.log(`  ⛔ ${c}`)
  } else if (warns.length > 0) {
    console.log(`VERDICT: DEGRADED — ${warns.length} warning(s) (coverage below threshold)`)
    for (const w of warns) console.log(`  ⚠  ${w}`)
  } else {
    console.log('VERDICT: READY ✅')
  }
  console.log()
}

main().catch(e => { console.error(e); process.exit(1) })
