import { readFileSync, readdirSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

export const VALID_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-7',
  'claude-haiku-4-5-20251001',
] as const;
export type ClaudeModel = (typeof VALID_MODELS)[number];

export const GOVERNANCE_FORBIDDEN_TOOLS = ['Edit', 'Write', 'Agent'] as const;

export const KNOWN_GOVERNANCE_AGENTS = [
  'codex-return-reviewer',
  'db-proof-reviewer',
  'lane-reconciler',
  'pr-risk-reviewer',
] as const;

export const SKILL_CATEGORIES = [
  'implementation',
  'governance',
  'review',
  'verification',
  'documentation',
] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export interface AgentContract {
  name: string;
  description: string;
  model: ClaudeModel;
  tools: string[];
}

export interface SkillContract {
  name: string;
  description?: string;
  category?: SkillCategory;
  owner?: string;
  trigger?: string;
}

export interface ValidationFailure {
  code: string;
  message: string;
}

export interface AgentValidationResult {
  file: string;
  valid: boolean;
  failures: ValidationFailure[];
  contract?: AgentContract;
}

export interface SkillValidationResult {
  file: string;
  valid: boolean;
  failures: ValidationFailure[];
  migrationNotes: string[];
  contract?: Partial<SkillContract>;
}

export function parseFrontmatter(content: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return {};
  try {
    const parsed = parseYaml(match[1]);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    return {};
  } catch {
    // Fall back to a line-by-line parser for frontmatter containing unquoted colons
    return parseFrontmatterFallback(match[1]);
  }
}

function parseFrontmatterFallback(block: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = block.split(/\r?\n/);
  let currentKey: string | null = null;
  const arrayItems: string[] = [];

  const flushArray = () => {
    if (currentKey && arrayItems.length > 0) {
      result[currentKey] = [...arrayItems];
      arrayItems.length = 0;
    }
  };

  for (const line of lines) {
    const arrayItem = /^\s+-\s+(.+)/.exec(line);
    if (arrayItem) {
      arrayItems.push(arrayItem[1].trim());
      continue;
    }
    const kvMatch = /^(\w[\w-]*):\s*(.*)/.exec(line);
    if (kvMatch) {
      flushArray();
      currentKey = kvMatch[1];
      const value = kvMatch[2].trim();
      result[currentKey] = value === '' ? null : value;
      continue;
    }
    if (line.trim() === '') {
      flushArray();
      currentKey = null;
    }
  }
  flushArray();
  return result;
}

export function validateAgent(filePath: string, content: string): AgentValidationResult {
  const frontmatter = parseFrontmatter(content);
  const failures: ValidationFailure[] = [];
  const fileName = basename(filePath, '.md');

  if (!frontmatter.name || typeof frontmatter.name !== 'string') {
    failures.push({ code: 'A1', message: 'Missing required field: name' });
  } else if (frontmatter.name !== fileName) {
    failures.push({
      code: 'A2',
      message: `name "${frontmatter.name}" must match filename "${fileName}"`,
    });
  }

  if (
    !frontmatter.description ||
    typeof frontmatter.description !== 'string' ||
    !frontmatter.description.trim()
  ) {
    failures.push({ code: 'A3', message: 'Missing or empty required field: description' });
  }

  if (!frontmatter.model || typeof frontmatter.model !== 'string') {
    failures.push({ code: 'A4', message: 'Missing required field: model' });
  } else if (!VALID_MODELS.includes(frontmatter.model as ClaudeModel)) {
    failures.push({
      code: 'A5',
      message: `Unrecognized model: "${frontmatter.model}". Must be one of: ${VALID_MODELS.join(', ')}`,
    });
  }

  if (!frontmatter.tools || !Array.isArray(frontmatter.tools) || frontmatter.tools.length === 0) {
    failures.push({ code: 'A6', message: 'tools must be a non-empty array' });
  } else {
    const isGovernance = (KNOWN_GOVERNANCE_AGENTS as readonly string[]).includes(fileName);
    if (isGovernance) {
      const forbidden = (frontmatter.tools as unknown[]).filter(
        (t): t is string =>
          typeof t === 'string' &&
          (GOVERNANCE_FORBIDDEN_TOOLS as readonly string[]).includes(t),
      );
      if (forbidden.length > 0) {
        failures.push({
          code: 'A7',
          message: `Governance agent must not use mutating tools: ${forbidden.join(', ')}`,
        });
      }
    }
  }

  if (failures.length > 0) {
    return { file: filePath, valid: false, failures };
  }

  return {
    file: filePath,
    valid: true,
    failures: [],
    contract: {
      name: frontmatter.name as string,
      description: frontmatter.description as string,
      model: frontmatter.model as ClaudeModel,
      tools: frontmatter.tools as string[],
    },
  };
}

export function validateSkill(filePath: string, content: string): SkillValidationResult {
  const frontmatter = parseFrontmatter(content);
  const failures: ValidationFailure[] = [];
  const migrationNotes: string[] = [];

  if (!frontmatter.name || typeof frontmatter.name !== 'string') {
    migrationNotes.push('S1: name field missing — required for .execution/skills/ promotion');
  }
  if (!frontmatter.description || typeof frontmatter.description !== 'string') {
    migrationNotes.push('S2: description field missing — required for cross-agent routing');
  }
  if (!frontmatter.category) {
    migrationNotes.push(
      `S3: category field missing — must be one of: ${SKILL_CATEGORIES.join(', ')}`,
    );
  } else if (!SKILL_CATEGORIES.includes(frontmatter.category as SkillCategory)) {
    failures.push({
      code: 'S4',
      message: `Unrecognized category: "${frontmatter.category}". Must be one of: ${SKILL_CATEGORIES.join(', ')}`,
    });
  }

  const contract: Partial<SkillContract> = {};
  if (typeof frontmatter.name === 'string') contract.name = frontmatter.name;
  if (typeof frontmatter.description === 'string') contract.description = frontmatter.description;
  if (typeof frontmatter.category === 'string') contract.category = frontmatter.category as SkillCategory;
  if (typeof frontmatter.owner === 'string') contract.owner = frontmatter.owner;
  if (typeof frontmatter.trigger === 'string') contract.trigger = frontmatter.trigger;

  return {
    file: filePath,
    valid: failures.length === 0,
    failures,
    migrationNotes,
    contract: Object.keys(contract).length > 0 ? contract : undefined,
  };
}

export function validateDirectory(
  agentsDir: string,
  skillsDir: string,
): {
  agents: AgentValidationResult[];
  skills: SkillValidationResult[];
  summary: {
    agentsValid: number;
    agentsInvalid: number;
    skillsValid: number;
    skillsWithNotes: number;
  };
} {
  const agents: AgentValidationResult[] = [];
  const skills: SkillValidationResult[] = [];

  for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const filePath = join(agentsDir, entry.name);
    agents.push(validateAgent(filePath, readFileSync(filePath, 'utf8')));
  }

  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = join(skillsDir, entry.name, 'SKILL.md');
    try {
      skills.push(validateSkill(skillFile, readFileSync(skillFile, 'utf8')));
    } catch {
      // SKILL.md missing — skip silently
    }
  }

  return {
    agents,
    skills,
    summary: {
      agentsValid: agents.filter((a) => a.valid).length,
      agentsInvalid: agents.filter((a) => !a.valid).length,
      skillsValid: skills.filter((s) => s.valid).length,
      skillsWithNotes: skills.filter((s) => s.migrationNotes.length > 0).length,
    },
  };
}

const argv1 = process.argv[1] ?? '';
if (argv1.endsWith('contract-validator.ts') || argv1.endsWith('contract-validator.js')) {
  const result = validateDirectory(resolve('.claude/agents'), resolve('.agents/skills'));
  console.log(JSON.stringify(result, null, 2));
  if (result.summary.agentsInvalid > 0) {
    process.exit(1);
  }
}
