// Proof freshness CLI — UTV2-643
// Run with: pnpm proof:check
// Detects stale or missing readiness evidence artifacts across active lanes.
import * as fs from 'node:fs'
import * as path from 'node:path'

const args = process.argv.slice(2)
const jsonMode = args.includes('--json')

const REPO_ROOT = path.resolve(__dirname, '..')
const LANES_DIR = path.join(REPO_ROOT, 'docs/06_status/lanes')
const PROOF_DIR = path.join(REPO_ROOT, 'docs/06_status/proof')

// ─── Thresholds ───────────────────────────────────────────────────────────────
const THRESHOLDS = {
  heartbeatWarnHr: 4,     // YELLOW if lane heartbeat > 4h ago
  heartbeatCritHr: 24,    // RED if lane heartbeat > 24h ago
  proofAgeWarnHr: 48,     // YELLOW if proof file > 48h old
  proofAgeCritHr: 168,    // RED if proof file > 1 week old
  missingProofWarnAgeLaneHr: 2,  // YELLOW if lane >2h old with missing expected proof
}

type SignalStatus = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN'

interface Signal {
  name: string
  status: SignalStatus
  value: string
  detail: string
}

interface LaneManifest {
  schema_version: number
  issue_id: string
  tier: string
  status: string
  started_at: string
  heartbeat_at: string
  expected_proof_paths: string[]
  file_scope_lock: string[]
}

function ageHr(ts: string, now: Date): number {
  return (now.getTime() - new Date(ts).getTime()) / 3600000
}

function ageFmt(hrs: number): string {
  if (hrs < 1) return `${Math.round(hrs * 60)}m`
  if (hrs < 24) return `${hrs.toFixed(1)}h`
  return `${(hrs / 24).toFixed(1)}d`
}

function fileAgeHr(filePath: string, now: Date): number | null {
  try {
    const stat = fs.statSync(filePath)
    return (now.getTime() - stat.mtimeMs) / 3600000
  } catch {
    return null
  }
}

function main() {
  const now = new Date()
  const signals: Signal[] = []
  const criticals: string[] = []
  const warns: string[] = []

  // ── 1. Load lane manifests ─────────────────────────────────────────────────
  let manifests: LaneManifest[] = []
  try {
    const files = fs.readdirSync(LANES_DIR).filter(f => f.endsWith('.json'))
    manifests = files.map(f => {
      const raw = fs.readFileSync(path.join(LANES_DIR, f), 'utf-8')
      return JSON.parse(raw) as LaneManifest
    })
  } catch (err) {
    const e = err as Error
    console.error(`FATAL: Cannot read lane manifests from ${LANES_DIR}: ${e.message}`)
    process.exit(1)
  }

  const activeManifests = manifests.filter(m =>
    m.status === 'started' || m.status === 'in_review'
  )
  const doneManifests = manifests.filter(m =>
    m.status === 'done' || m.status === 'merged'
  )

  // ── 2. Lane Heartbeat Freshness ────────────────────────────────────────────
  {
    if (activeManifests.length === 0) {
      signals.push({ name: 'Lane Heartbeat', status: 'GREEN', value: '0 active lanes', detail: 'No active lanes to check' })
    } else {
      const staleRed: string[] = []
      const staleWarn: string[] = []
      for (const m of activeManifests) {
        const hrs = ageHr(m.heartbeat_at, now)
        if (hrs > THRESHOLDS.heartbeatCritHr) {
          staleRed.push(`${m.issue_id} (${ageFmt(hrs)} since heartbeat)`)
        } else if (hrs > THRESHOLDS.heartbeatWarnHr) {
          staleWarn.push(`${m.issue_id} (${ageFmt(hrs)} since heartbeat)`)
        }
      }
      const freshCount = activeManifests.length - staleRed.length - staleWarn.length
      if (staleRed.length > 0) {
        const status: SignalStatus = 'RED'
        signals.push({ name: 'Lane Heartbeat', status, value: `${staleRed.length} stale (RED)`, detail: staleRed.join('; ') })
        criticals.push(`Lane Heartbeat: ${staleRed.join(', ')}`)
      } else if (staleWarn.length > 0) {
        signals.push({ name: 'Lane Heartbeat', status: 'YELLOW', value: `${staleWarn.length} stale (WARN)`, detail: staleWarn.join('; ') })
        warns.push(`Lane Heartbeat: ${staleWarn.join(', ')}`)
      } else {
        signals.push({ name: 'Lane Heartbeat', status: 'GREEN', value: `${freshCount}/${activeManifests.length} fresh`, detail: `All active lanes have recent heartbeat (<${THRESHOLDS.heartbeatWarnHr}h)` })
      }
    }
  }

  // ── 3. Expected Proof Completeness ────────────────────────────────────────
  {
    const missingRed: string[] = []
    const missingWarn: string[] = []
    let totalExpected = 0
    let presentCount = 0

    for (const m of [...activeManifests, ...doneManifests]) {
      if (!m.expected_proof_paths || m.expected_proof_paths.length === 0) continue
      const laneAgeHrs = ageHr(m.started_at, now)
      for (const relPath of m.expected_proof_paths) {
        totalExpected++
        const absPath = path.join(REPO_ROOT, relPath)
        if (fs.existsSync(absPath)) {
          presentCount++
        } else if (laneAgeHrs > THRESHOLDS.missingProofWarnAgeLaneHr) {
          if (m.status === 'done' || m.status === 'merged') {
            missingRed.push(`${m.issue_id}: ${relPath}`)
          } else {
            missingWarn.push(`${m.issue_id}: ${relPath}`)
          }
        }
      }
    }

    if (totalExpected === 0) {
      signals.push({ name: 'Expected Proof Completeness', status: 'GREEN', value: 'no required proof', detail: 'No lanes declare expected_proof_paths' })
    } else if (missingRed.length > 0) {
      signals.push({ name: 'Expected Proof Completeness', status: 'RED', value: `${missingRed.length} missing`, detail: missingRed.join('; ') })
      criticals.push(`Missing required proof: ${missingRed.join(', ')}`)
    } else if (missingWarn.length > 0) {
      signals.push({ name: 'Expected Proof Completeness', status: 'YELLOW', value: `${missingWarn.length} missing`, detail: missingWarn.join('; ') })
      warns.push(`Missing expected proof: ${missingWarn.join(', ')}`)
    } else {
      signals.push({ name: 'Expected Proof Completeness', status: 'GREEN', value: `${presentCount}/${totalExpected} present`, detail: 'All expected proof paths exist' })
    }
  }

  // ── 4. Proof File Age ──────────────────────────────────────────────────────
  {
    let proofDirs: string[] = []
    try {
      proofDirs = fs.readdirSync(PROOF_DIR, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
    } catch {
      // proof dir may not exist
    }

    const staleRed: string[] = []
    const staleWarn: string[] = []
    let checkedFiles = 0

    for (const dir of proofDirs) {
      const dirPath = path.join(PROOF_DIR, dir)
      try {
        const files = fs.readdirSync(dirPath)
        for (const file of files) {
          const filePath = path.join(dirPath, file)
          const hrs = fileAgeHr(filePath, now)
          if (hrs === null) continue
          checkedFiles++
          if (hrs > THRESHOLDS.proofAgeCritHr) {
            staleRed.push(`${dir}/${file} (${ageFmt(hrs)})`)
          } else if (hrs > THRESHOLDS.proofAgeWarnHr) {
            staleWarn.push(`${dir}/${file} (${ageFmt(hrs)})`)
          }
        }
      } catch { /* skip unreadable dirs */ }
    }

    if (checkedFiles === 0) {
      signals.push({ name: 'Proof File Age', status: 'UNKNOWN', value: 'no proof files', detail: 'No proof files found to check age' })
    } else if (staleRed.length > 0) {
      signals.push({ name: 'Proof File Age', status: 'RED', value: `${staleRed.length} critical-stale`, detail: staleRed.slice(0, 5).join('; ') + (staleRed.length > 5 ? ` (+${staleRed.length - 5} more)` : '') })
      criticals.push(`Critical-stale proof: ${staleRed[0]}`)
    } else if (staleWarn.length > 0) {
      signals.push({ name: 'Proof File Age', status: 'YELLOW', value: `${staleWarn.length} aging`, detail: staleWarn.slice(0, 5).join('; ') })
      warns.push(`Aging proof: ${staleWarn[0]}`)
    } else {
      signals.push({ name: 'Proof File Age', status: 'GREEN', value: `${checkedFiles} files fresh`, detail: `All proof files < ${THRESHOLDS.proofAgeWarnHr}h old` })
    }
  }

  // ── 5. Orphaned Proof Dirs ─────────────────────────────────────────────────
  {
    let proofDirs: string[] = []
    try {
      proofDirs = fs.readdirSync(PROOF_DIR, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
    } catch { /* proof dir may not exist */ }

    const manifestIssueIds = new Set(manifests.map(m => m.issue_id))
    const orphaned = proofDirs.filter(dir => {
      // Match dirs like "UTV2-640" against issue IDs
      const issueId = dir.toUpperCase()
      return !manifestIssueIds.has(issueId)
    })

    if (orphaned.length === 0) {
      signals.push({ name: 'Orphaned Proof Dirs', status: 'GREEN', value: '0 orphaned', detail: 'All proof dirs match an active lane manifest' })
    } else {
      signals.push({ name: 'Orphaned Proof Dirs', status: 'YELLOW', value: `${orphaned.length} orphaned`, detail: orphaned.join(', ') })
      warns.push(`Orphaned proof dirs (no manifest): ${orphaned.join(', ')}`)
    }
  }

  // ── Output ─────────────────────────────────────────────────────────────────
  const RED = '\x1b[31m', YELLOW = '\x1b[33m', GREEN = '\x1b[32m', CYAN = '\x1b[36m', RESET = '\x1b[0m', BOLD = '\x1b[1m'

  if (jsonMode) {
    console.log(JSON.stringify({
      timestamp: now.toISOString(),
      signals,
      summary: { criticals, warns, passed: signals.filter(s => s.status === 'GREEN').length }
    }, null, 2))
  } else {
    console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════════════╗${RESET}`)
    console.log(`${BOLD}${CYAN}║          PROOF FRESHNESS REPORT                  ║${RESET}`)
    console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════╝${RESET}`)
    console.log(`  ${new Date().toISOString()}\n`)

    for (const s of signals) {
      const color = s.status === 'RED' ? RED : s.status === 'YELLOW' ? YELLOW : s.status === 'GREEN' ? GREEN : CYAN
      const icon = s.status === 'RED' ? '✗' : s.status === 'YELLOW' ? '⚠' : s.status === 'GREEN' ? '✓' : '?'
      console.log(`  ${color}${BOLD}[${s.status.padEnd(7)}]${RESET} ${s.name}`)
      console.log(`            Value:  ${s.value}`)
      console.log(`            Detail: ${s.detail}\n`)
    }

    if (criticals.length > 0) {
      console.log(`${RED}${BOLD}CRITICAL:${RESET}`)
      criticals.forEach(c => console.log(`  ${RED}✗ ${c}${RESET}`))
      console.log()
    }
    if (warns.length > 0) {
      console.log(`${YELLOW}${BOLD}WARNINGS:${RESET}`)
      warns.forEach(w => console.log(`  ${YELLOW}⚠ ${w}${RESET}`))
      console.log()
    }
    const ok = criticals.length === 0
    console.log(`${ok ? GREEN : RED}${BOLD}STATUS: ${ok ? 'PASS' : 'FAIL'}${RESET}  (${signals.filter(s=>s.status==='GREEN').length} green, ${warns.length} warn, ${criticals.length} critical)\n`)
  }

  process.exit(criticals.length > 0 ? 1 : 0)
}

main()
