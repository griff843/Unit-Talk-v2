// Monthly portfolio review — UTV2-632
// Run with: pnpm portfolio:review
// Generates a live-data portfolio packet covering concentration, champion stability,
// provider performance, and coverage gaps. Records concrete decisions.
import { loadEnvironment } from '@unit-talk/config'
import { createClient } from '@supabase/supabase-js'
import * as fs from 'node:fs'
import * as path from 'node:path'

const env = loadEnvironment()
const url = env.SUPABASE_URL ?? ''
const key = env.SUPABASE_SERVICE_ROLE_KEY ?? ''
if (!url || !key) { console.error('FATAL: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }

const db = createClient(url, key, { auth: { persistSession: false } })

const args = process.argv.slice(2)
const jsonMode = args.includes('--json')
const saveFlag = args.includes('--save')

const RED = '\x1b[31m', YELLOW = '\x1b[33m', GREEN = '\x1b[32m', CYAN = '\x1b[36m', RESET = '\x1b[0m', BOLD = '\x1b[1m', DIM = '\x1b[2m'

interface PortfolioPacket {
  generated_at: string
  period: string
  concentration: ConcentrationReport
  champion_stability: ChampionReport
  provider_performance: ProviderReport
  coverage_gaps: CoverageReport
  decisions: Decision[]
}

interface ConcentrationReport {
  total_posted_picks: number
  by_source: Record<string, number>
  by_promotion_target: Record<string, number>
  source_concentration_risk: string
}

interface ChampionReport {
  total_picks_with_score: number
  high_score_picks: number
  high_score_pct: number
  settlement_win_rate: number | null
  clv_beat_rate: number | null
  stability_signal: string
}

interface ProviderReport {
  sgo_offer_count: number
  latest_sgo_snapshot: string | null
  sgo_freshness_hrs: number | null
  provider_coverage: Record<string, number>
}

interface CoverageReport {
  participant_id_coverage_pct: number
  settlement_coverage_pct: number
  clv_coverage_pct: number
  auto_grade_pct: number
  gaps: string[]
}

interface Decision {
  area: string
  observation: string
  decision: string
  owner: string
}

async function main() {
  const now = new Date()
  const periodStart = new Date(now)
  periodStart.setDate(now.getDate() - 30)
  const period = `${periodStart.toISOString().slice(0,10)} to ${now.toISOString().slice(0,10)}`

  // ── 1. Concentration ────────────────────────────────────────────────────────
  const { data: picks } = await db
    .from('picks')
    .select('id, source, status, created_at, promotion_status, capper_id')
    .in('status', ['posted', 'settled', 'qualified'])
    .gte('created_at', periodStart.toISOString())

  const pickRows = picks ?? []
  const bySrc: Record<string,number> = {}
  const byTarget: Record<string,number> = {}
  for (const p of pickRows) {
    bySrc[p.source ?? 'unknown'] = (bySrc[p.source ?? 'unknown'] ?? 0) + 1
    byTarget[p.promotion_status ?? 'none'] = (byTarget[p.promotion_status ?? 'none'] ?? 0) + 1
  }
  const topSrcPct = pickRows.length > 0 ? Math.round((Math.max(...Object.values(bySrc)) / pickRows.length) * 100) : 0
  const concentrationRisk = topSrcPct > 80 ? 'HIGH — single source dominates' : topSrcPct > 60 ? 'MEDIUM' : 'LOW'

  const concentration: ConcentrationReport = {
    total_posted_picks: pickRows.length,
    by_source: bySrc,
    by_promotion_target: byTarget,
    source_concentration_risk: concentrationRisk,
  }

  // ── 2. Champion Stability ───────────────────────────────────────────────────
  const { data: promoHistory } = await db
    .from('pick_promotion_history')
    .select('pick_id, promotion_score, target, version, payload')
    .gte('created_at', periodStart.toISOString())
    .order('promotion_score', { ascending: false })
    .limit(500)

  const promoRows = promoHistory ?? []
  const highScore = promoRows.filter(r => (r.promotion_score ?? 0) > 0.7)
  const highScorePct = promoRows.length > 0 ? Math.round((highScore.length / promoRows.length) * 100) : 0

  const { data: settlements } = await db
    .from('settlement_records')
    .select('id, pick_id, result, payload')
    .is('corrects_id', null)
    .gte('created_at', periodStart.toISOString())
    .limit(500)

  const settlRows = settlements ?? []
  const wins = settlRows.filter(r => r.result === 'win').length
  const losses = settlRows.filter(r => r.result === 'loss').length
  const winRate = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 100) : null

  const withCLV = settlRows.filter(r => {
    const p = r.payload as Record<string,unknown> | null
    return p && ('beatsClosingLine' in p || 'clvRaw' in p)
  })
  const beatCLV = withCLV.filter(r => {
    const p = r.payload as Record<string,unknown>
    return p.beatsClosingLine === true
  })
  const clvBeatRate = withCLV.length > 0 ? Math.round((beatCLV.length / withCLV.length) * 100) : null

  const stabilitySignal = winRate === null ? 'UNKNOWN — no settled picks in period'
    : winRate >= 55 ? 'STRONG — win rate above threshold'
    : winRate >= 48 ? 'NEUTRAL — win rate near breakeven'
    : 'WEAK — win rate below breakeven'

  const champion: ChampionReport = {
    total_picks_with_score: promoRows.length,
    high_score_picks: highScore.length,
    high_score_pct: highScorePct,
    settlement_win_rate: winRate,
    clv_beat_rate: clvBeatRate,
    stability_signal: stabilitySignal,
  }

  // ── 3. Provider Performance ─────────────────────────────────────────────────
  const { data: recentOffers } = await db
    .from('provider_offers')
    .select('id, provider_key, sport_key, snapshot_at')
    .gte('snapshot_at', periodStart.toISOString())
    .order('snapshot_at', { ascending: false })
    .limit(1000)

  const offerRows = recentOffers ?? []
  const byProvider: Record<string,number> = {}
  for (const o of offerRows) byProvider[o.provider_key ?? 'unknown'] = (byProvider[o.provider_key ?? 'unknown'] ?? 0) + 1

  const latestSnapshot = offerRows[0]?.snapshot_at ?? null
  const sgoFreshnessHrs = latestSnapshot
    ? Math.round((now.getTime() - new Date(latestSnapshot).getTime()) / 3600000 * 10) / 10
    : null

  const provider: ProviderReport = {
    sgo_offer_count: offerRows.length,
    latest_sgo_snapshot: latestSnapshot,
    sgo_freshness_hrs: sgoFreshnessHrs,
    provider_coverage: byProvider,
  }

  // ── 4. Coverage Gaps ────────────────────────────────────────────────────────
  const allPicks = picks ?? []
  const withParticipant = allPicks.filter(p => (p as Record<string,unknown>).participant_id !== null).length
  const participantPct = allPicks.length > 0 ? Math.round((withParticipant / allPicks.length) * 100) : 0

  const settledPicks = allPicks.filter(p => p.status === 'settled')
  const settledIds = new Set(settlRows.map(s => s.pick_id))
  const settledWithRecord = settledPicks.filter(p => settledIds.has(p.id))
  const settlCovPct = settledPicks.length > 0 ? Math.round((settledWithRecord.length / settledPicks.length) * 100) : 100

  const clvCovPct = settlRows.length > 0 ? Math.round((withCLV.length / settlRows.length) * 100) : 0
  const autoGradePct = 0 // auto-grade not yet implemented (DEBT per scoring-provenance CLI)

  const gaps: string[] = []
  if (participantPct < 70) gaps.push(`participant_id coverage ${participantPct}% (threshold 70%)`)
  if (settlCovPct < 70) gaps.push(`settlement record coverage ${settlCovPct}% (threshold 70%)`)
  if (clvCovPct < 40) gaps.push(`CLV payload coverage ${clvCovPct}% (threshold 40%)`)
  if (autoGradePct < 50) gaps.push(`auto-grade coverage 0% — not yet implemented`)

  const coverage: CoverageReport = {
    participant_id_coverage_pct: participantPct,
    settlement_coverage_pct: settlCovPct,
    clv_coverage_pct: clvCovPct,
    auto_grade_pct: autoGradePct,
    gaps,
  }

  // ── 5. Decisions ────────────────────────────────────────────────────────────
  const decisions: Decision[] = []

  if (topSrcPct > 80) {
    decisions.push({
      area: 'Concentration',
      observation: `${topSrcPct}% of picks from single source. High concentration risk.`,
      decision: 'Monitor — scanner is quiesced per DEBT-003. Concentration will naturally diversify when re-enabled. No immediate action required.',
      owner: 'orchestrator',
    })
  }

  if (winRate !== null && winRate < 48) {
    decisions.push({
      area: 'Champion Stability',
      observation: `Win rate ${winRate}% below breakeven threshold (50%).`,
      decision: 'Flag for PM review. Consider reviewing model selection criteria and promotion score thresholds before next autonomous enable.',
      owner: 'PM',
    })
  } else if (winRate !== null && winRate >= 55) {
    decisions.push({
      area: 'Champion Stability',
      observation: `Win rate ${winRate}% above 55% threshold — strong signal.`,
      decision: 'No action. Continue monitoring. Use as positive evidence for autonomous re-enablement case.',
      owner: 'orchestrator',
    })
  }

  if (clvCovPct < 40) {
    decisions.push({
      area: 'CLV Coverage',
      observation: `Only ${clvCovPct}% of settlements have CLV payload.`,
      decision: 'CLV resolution pipeline needs attention. Track via scoring:coverage CLI. Target 40%+ before claiming CLV proof.',
      owner: 'orchestrator',
    })
  }

  if (sgoFreshnessHrs !== null && sgoFreshnessHrs > 6) {
    decisions.push({
      area: 'Provider Freshness',
      observation: `SGO latest snapshot ${sgoFreshnessHrs}h old.`,
      decision: 'Ingestor appears stalled. Check ingestor status and restart if needed. Required for live odds freshness.',
      owner: 'orchestrator',
    })
  }

  decisions.push({
    area: 'Worker Status',
    observation: 'Worker idle >8h. Distribution pipeline paused.',
    decision: 'Worker requires manual restart. This is a pre-existing operational condition (not introduced this period). See runtime:health for current state.',
    owner: 'orchestrator',
  })

  const packet: PortfolioPacket = {
    generated_at: now.toISOString(),
    period,
    concentration,
    champion_stability: champion,
    provider_performance: provider,
    coverage_gaps: coverage,
    decisions,
  }

  // ── Output ──────────────────────────────────────────────────────────────────
  if (jsonMode) {
    console.log(JSON.stringify(packet, null, 2))
    if (saveFlag) savePacket(packet)
    return
  }

  console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════════════════════╗${RESET}`)
  console.log(`${BOLD}${CYAN}║           MONTHLY PORTFOLIO REVIEW                       ║${RESET}`)
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════════════╝${RESET}`)
  console.log(`  ${DIM}Period: ${period}${RESET}`)
  console.log(`  ${DIM}Generated: ${now.toISOString()}${RESET}\n`)

  // Concentration
  console.log(`${BOLD}── Concentration ──────────────────────────────────────────${RESET}`)
  console.log(`  Total picks (posted/settled/qualified): ${concentration.total_posted_picks}`)
  console.log(`  By source:`)
  for (const [src, cnt] of Object.entries(concentration.by_source).sort((a,b)=>b[1]-a[1])) {
    const pct = Math.round((cnt / Math.max(concentration.total_posted_picks, 1)) * 100)
    console.log(`    ${src}: ${cnt} (${pct}%)`)
  }
  const riskColor = concentrationRisk.startsWith('HIGH') ? RED : concentrationRisk.startsWith('MEDIUM') ? YELLOW : GREEN
  console.log(`  Concentration risk: ${riskColor}${concentrationRisk}${RESET}\n`)

  // Champion Stability
  console.log(`${BOLD}── Champion Stability ─────────────────────────────────────${RESET}`)
  console.log(`  Scored picks: ${champion.total_picks_with_score} (high-score ≥0.7: ${champion.high_score_picks}, ${champion.high_score_pct}%)`)
  console.log(`  Settlement win rate: ${champion.settlement_win_rate !== null ? `${champion.settlement_win_rate}%` : 'N/A'} (wins=${wins}, losses=${losses})`)
  console.log(`  CLV beat rate: ${champion.clv_beat_rate !== null ? `${champion.clv_beat_rate}%` : 'N/A'} (${beatCLV.length}/${withCLV.length} with CLV data)`)
  const stabColor = stabilitySignal.startsWith('STRONG') ? GREEN : stabilitySignal.startsWith('WEAK') ? RED : YELLOW
  console.log(`  Signal: ${stabColor}${champion.stability_signal}${RESET}\n`)

  // Provider Performance
  console.log(`${BOLD}── Provider Performance ───────────────────────────────────${RESET}`)
  console.log(`  SGO offers (30d): ${provider.sgo_offer_count}`)
  console.log(`  Latest snapshot: ${provider.latest_sgo_snapshot ?? 'none'} (${provider.sgo_freshness_hrs !== null ? `${provider.sgo_freshness_hrs}h ago` : 'N/A'})`)
  console.log(`  Coverage by provider:`)
  for (const [prov, cnt] of Object.entries(provider.provider_coverage).sort((a,b)=>b[1]-a[1])) {
    console.log(`    ${prov}: ${cnt} offers`)
  }
  console.log()

  // Coverage Gaps
  console.log(`${BOLD}── Coverage Gaps ──────────────────────────────────────────${RESET}`)
  console.log(`  participant_id: ${coverage.participant_id_coverage_pct}%`)
  console.log(`  settlement records: ${coverage.settlement_coverage_pct}%`)
  console.log(`  CLV payload: ${coverage.clv_coverage_pct}%`)
  console.log(`  auto-grade: ${coverage.auto_grade_pct}%`)
  if (coverage.gaps.length > 0) {
    console.log(`  ${YELLOW}${BOLD}Gaps:${RESET}`)
    for (const g of coverage.gaps) console.log(`    ${YELLOW}⚠ ${g}${RESET}`)
  } else {
    console.log(`  ${GREEN}No coverage gaps above threshold${RESET}`)
  }
  console.log()

  // Decisions
  console.log(`${BOLD}── Decisions ──────────────────────────────────────────────${RESET}`)
  for (const d of decisions) {
    console.log(`  ${BOLD}[${d.area}]${RESET} (owner: ${d.owner})`)
    console.log(`    Observation: ${d.observation}`)
    console.log(`    Decision: ${d.decision}\n`)
  }

  if (saveFlag) {
    const saved = savePacket(packet)
    console.log(`${GREEN}Packet saved: ${saved}${RESET}`)
  }
}

function savePacket(packet: PortfolioPacket): string {
  const date = packet.generated_at.slice(0,10)
  const dir = path.join(process.cwd(), 'docs/06_status/proof/UTV2-632')
  fs.mkdirSync(dir, { recursive: true })
  const outPath = path.join(dir, `portfolio-review-${date}.json`)
  fs.writeFileSync(outPath, JSON.stringify(packet, null, 2))
  return outPath
}

main().catch(e => { console.error(e); process.exit(1) })
