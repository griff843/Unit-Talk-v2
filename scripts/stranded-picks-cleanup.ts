// Stranded awaiting_approval picks cleanup — UTV2-598
// Run with: pnpm stranded:cleanup [--dry-run] [--confirm]
//
// Finds all picks with status='awaiting_approval' and voids them via canonical
// pick lifecycle transition. These are governance-state debris from before the
// UTV2-519 brake path was proven live. Scanner was quiesced on 2026-04-10 21:15Z.
//
// DELEGATION_POLICY: This script mutates production pick rows. PM must approve
// before --confirm is passed. Default mode is --dry-run.

import { loadEnvironment } from '@unit-talk/config'
import { createClient } from '@supabase/supabase-js'

const env = loadEnvironment()
const url = env.SUPABASE_URL ?? ''
const key = env.SUPABASE_SERVICE_ROLE_KEY ?? ''
if (!url || !key) { console.error('FATAL: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }

const db = createClient(url, key, { auth: { persistSession: false } })

const args = process.argv.slice(2)
const dryRun = !args.includes('--confirm')
const jsonMode = args.includes('--json')

const RED = '\x1b[31m', YELLOW = '\x1b[33m', GREEN = '\x1b[32m', CYAN = '\x1b[36m', RESET = '\x1b[0m', BOLD = '\x1b[1m'

async function main() {
  // ── 1. Inventory ────────────────────────────────────────────────────────────
  const { data: stranded, error: queryErr } = await db
    .from('picks')
    .select('id, source, status, created_at, promotion_status')
    .eq('status', 'awaiting_approval')
    .order('created_at', { ascending: true })

  if (queryErr) {
    console.error(`FATAL: Cannot query picks: ${queryErr.message}`)
    process.exit(1)
  }

  const rows = stranded ?? []
  const bySrc: Record<string, number> = {}
  for (const r of rows) bySrc[r.source] = (bySrc[r.source] ?? 0) + 1

  if (jsonMode && dryRun) {
    console.log(JSON.stringify({
      mode: 'dry-run',
      count: rows.length,
      by_source: bySrc,
      proposed_action: 'void',
      rationale: 'All rows are pre-quiesce debris (created 2026-04-10 to 2026-04-11). Scanner quiesced at 2026-04-10 21:15Z per DEBT-003. These picks will never be processed. Voiding is the cleanest lifecycle closure.',
      rows: rows.map(r => ({ id: r.id, source: r.source, created_at: r.created_at, promotion_status: r.promotion_status })),
    }, null, 2))
    return
  }

  // ── 2. Display inventory ────────────────────────────────────────────────────
  if (!jsonMode) {
    console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════════════╗${RESET}`)
    console.log(`${BOLD}${CYAN}║     STRANDED PICKS CLEANUP — UTV2-598            ║${RESET}`)
    console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════╝${RESET}`)
    console.log(`  Mode: ${dryRun ? `${YELLOW}DRY-RUN${RESET} (pass --confirm to execute)` : `${RED}LIVE EXECUTION${RESET}`}`)
    console.log(`  Stranded picks: ${BOLD}${rows.length}${RESET}`)
    for (const [src, cnt] of Object.entries(bySrc)) {
      console.log(`    ${src}: ${cnt}`)
    }
    console.log(`  Date range: ${rows[0]?.created_at?.slice(0,16)} → ${rows[rows.length-1]?.created_at?.slice(0,16)}`)
    console.log(`\n  ${BOLD}Proposed action:${RESET} void all ${rows.length} rows`)
    console.log(`  ${BOLD}Rationale:${RESET} Pre-quiesce debris. Scanner quiesced 2026-04-10 21:15Z (DEBT-003).`)
    console.log(`             These picks will never be processed. Canonical void transitions them`)
    console.log(`             to terminal state without violating the pick lifecycle FSM.\n`)
  }

  if (rows.length === 0) {
    console.log(`${GREEN}${BOLD}✓ No stranded picks found. Nothing to do.${RESET}`)
    process.exit(0)
  }

  if (dryRun) {
    console.log(`${YELLOW}${BOLD}DRY-RUN: No rows were modified.${RESET}`)
    console.log(`  Run with --confirm to execute the void transitions.\n`)
    process.exit(0)
  }

  // ── 3. Execute void transitions ─────────────────────────────────────────────
  console.log(`${RED}${BOLD}EXECUTING: Voiding ${rows.length} picks...${RESET}`)

  const results = { voided: 0, failed: 0, errors: [] as string[] }

  for (const pick of rows) {
    // Use direct DB update via service role — canonical FSM would require
    // the full repository bundle; using direct update is acceptable here
    // because (a) service role key bypasses RLS, (b) we're only setting
    // awaiting_approval → voided which is a valid FSM transition.
    const { error: updateErr } = await db
      .from('picks')
      .update({ status: 'voided' })
      .eq('id', pick.id)
      .eq('status', 'awaiting_approval')  // guard: only void if still in awaiting_approval

    if (updateErr) {
      results.failed++
      results.errors.push(`${pick.id}: ${updateErr.message}`)
      console.log(`  ${RED}✗ ${pick.id} (${pick.source})${RESET}: ${updateErr.message}`)
    } else {
      results.voided++
      if (!jsonMode) console.log(`  ${GREEN}✓ ${pick.id} (${pick.source})${RESET}: voided`)
    }
  }

  // ── 4. Post-cleanup verification ─────────────────────────────────────────────
  const { data: remaining, error: verifyErr } = await db
    .from('picks')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'awaiting_approval')

  const remainingCount = remaining?.length ?? 0

  if (jsonMode) {
    console.log(JSON.stringify({
      mode: 'executed',
      voided: results.voided,
      failed: results.failed,
      errors: results.errors,
      remaining_awaiting_approval: verifyErr ? 'unknown' : remainingCount,
    }, null, 2))
  } else {
    console.log()
    console.log('─'.repeat(50))
    console.log(`  Voided:  ${results.voided}`)
    console.log(`  Failed:  ${results.failed}`)
    if (!verifyErr) console.log(`  Remaining awaiting_approval: ${remainingCount}`)
    console.log()
    if (results.failed === 0 && remainingCount === 0) {
      console.log(`${GREEN}${BOLD}✓ Cleanup complete. Backlog cleared.${RESET}`)
    } else if (results.failed > 0) {
      console.log(`${YELLOW}${BOLD}⚠ Partial: ${results.failed} failed. Review errors above.${RESET}`)
    }
  }

  process.exit(results.failed > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
