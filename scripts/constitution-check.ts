/**
 * constitution:check (SPRINT-CONSTITUTION-RESTORATION-AND-RATIFICATION-001)
 *
 * Preservation guard for the Unit Talk Constitution. Fails closed (exit 1) if any
 * required constitutional artifact is missing or if the constitution has lost
 * structural completeness (19 capability layers, principles, roadmap, end state).
 *
 * This guard does NOT validate doctrine content — it ensures the constitution
 * and its mapping artifacts cannot silently disappear or be structurally gutted.
 *
 * Usage:
 *   pnpm constitution:check          # human output
 *   pnpm constitution:check --json   # structured JSON
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const CONSTITUTION = 'docs/00_constitution/UNIT_TALK_CONSTITUTION_V1.md';

/** Required constitutional artifacts — every one must exist. */
const REQUIRED_FILES = [
  CONSTITUTION,
  'docs/00_constitution/README.md',
  'docs/00_constitution/CONSTITUTION_IMPLEMENTATION_MATRIX.md',
  'docs/00_constitution/CONSTITUTIONAL_DRIFT_AUDIT.md',
  'docs/00_constitution/PROGRAM_ALIGNMENT_MATRIX.md',
  'docs/02_architecture/CONSTITUTIONAL_LINEAR_EXECUTION_STRUCTURE.md',
] as const;

/** SHA-256 of the recovered constitutional source, for tamper-evidence (warn-only). */
const PINNED_CONSTITUTION_SHA256 =
  'b22b6e5b47ece0d2b04688ad4b29e2fc3cb20fd09d00e50f91ac1e5fe3e2efc5';

const EXPECTED_CAPABILITY_LAYERS = 19;

export interface CheckResult {
  ok: boolean;
  failures: string[];
  warnings: string[];
  capabilityLayersFound: number;
  constitutionSha256: string | null;
}

function checkConstitutionStructure(text: string, failures: string[]): number {
  // Capability layers: "## 4.1 ..." through "## 4.19 ..."
  const layerNums = new Set<number>();
  for (const m of text.matchAll(/^##\s+4\.(\d+)\s+/gm)) {
    layerNums.add(Number(m[1]));
  }
  if (layerNums.size !== EXPECTED_CAPABILITY_LAYERS) {
    failures.push(
      `Expected ${EXPECTED_CAPABILITY_LAYERS} capability layers (§4.1–§4.19), found ${layerNums.size}`,
    );
  }
  for (let n = 1; n <= EXPECTED_CAPABILITY_LAYERS; n++) {
    if (!layerNums.has(n)) failures.push(`Missing capability layer §4.${n}`);
  }

  // Constitutional principles section + the 14 principles.
  if (!/^#\s+2\.\s+Constitutional Principles/m.test(text)) {
    failures.push('Missing "# 2. Constitutional Principles" section');
  }
  const principleNums = new Set<number>();
  for (const m of text.matchAll(/^##\s+2\.(\d+)\s+/gm)) principleNums.add(Number(m[1]));
  if (principleNums.size < 14) {
    failures.push(`Expected 14 constitutional principles (§2.1–§2.14), found ${principleNums.size}`);
  }

  // Roadmap + Programs 1–5.
  if (!/^#\s+18\.\s+Implementation Roadmap/m.test(text)) {
    failures.push('Missing "# 18. Implementation Roadmap" section');
  }
  for (const p of ['Program 1', 'Program 2', 'Program 3', 'Program 4', 'Program 5']) {
    if (!text.includes(p)) failures.push(`Roadmap missing ${p}`);
  }

  // End state.
  if (!/^#\s+23\.\s+Constitutional End State/m.test(text)) {
    failures.push('Missing "# 23. Constitutional End State" section');
  }

  return layerNums.size;
}

export function runConstitutionCheck(): CheckResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  let capabilityLayersFound = 0;
  let constitutionSha256: string | null = null;

  for (const rel of REQUIRED_FILES) {
    if (!existsSync(resolve(REPO_ROOT, rel))) {
      failures.push(`Missing required constitutional artifact: ${rel}`);
    }
  }

  const constitutionPath = resolve(REPO_ROOT, CONSTITUTION);
  if (existsSync(constitutionPath)) {
    const buf = readFileSync(constitutionPath);
    constitutionSha256 = createHash('sha256').update(buf).digest('hex');
    if (constitutionSha256 !== PINNED_CONSTITUTION_SHA256) {
      warnings.push(
        `Constitution SHA-256 changed from pinned value. ` +
          `pinned=${PINNED_CONSTITUTION_SHA256} actual=${constitutionSha256}. ` +
          `If this change was an intentional re-ratification, update the pin; otherwise investigate tampering.`,
      );
    }
    capabilityLayersFound = checkConstitutionStructure(buf.toString('utf8'), failures);
  }

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    capabilityLayersFound,
    constitutionSha256,
  };
}

function main(): void {
  const jsonMode = process.argv.slice(2).includes('--json');
  const result = runConstitutionCheck();

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('Constitution preservation check');
    console.log(`  files required:      ${REQUIRED_FILES.length}`);
    console.log(`  capability layers:   ${result.capabilityLayersFound}/${EXPECTED_CAPABILITY_LAYERS}`);
    console.log(`  constitution sha256: ${result.constitutionSha256 ?? '(missing)'}`);
    for (const w of result.warnings) console.log(`  WARN: ${w}`);
    for (const f of result.failures) console.log(`  FAIL: ${f}`);
    console.log(result.ok ? '  RESULT: PASS' : '  RESULT: FAIL');
  }

  if (!result.ok) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
