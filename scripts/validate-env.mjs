import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const envExamplePath = path.join(root, '.env.example');
const localEnvPath = path.join(root, 'local.env');

const requiredSharedKeys = [
  'NODE_ENV',
  'UNIT_TALK_APP_ENV',
  'UNIT_TALK_ACTIVE_WORKSPACE',
  'UNIT_TALK_LEGACY_WORKSPACE',
  'LINEAR_TEAM_ID',
  'LINEAR_TEAM_KEY',
  'LINEAR_TEAM_NAME',
];

const discouragedSharedSecretKeys = [
  'LINEAR_API_TOKEN',
  'LINEAR_API_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DISCORD_BOT_TOKEN',
  'OPENAI_API_KEY',
  'NOTION_TOKEN',
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET',
];

const BOM_BYTES = Buffer.from([0xef, 0xbb, 0xbf]);

export function checkForBom(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(BOM_BYTES)) {
    const fileName = path.basename(filePath);
    throw new Error(
      `${fileName} has a UTF-8 BOM at byte 0 — re-save the file without a BOM, e.g. ` +
        `sed -i '1s/^\\xef\\xbb\\xbf//' ${fileName}`,
    );
  }
}

export function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing env file: ${path.basename(filePath)}`);
  }

  checkForBom(filePath);

  const raw = fs.readFileSync(filePath, 'utf8');
  const result = new Map();

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    result.set(key, value);
  }

  return result;
}

export function checkMissingSharedKeys(sharedEnv) {
  return requiredSharedKeys.filter((key) => !sharedEnv.has(key));
}

export function checkLeakedSecrets(sharedEnv) {
  return discouragedSharedSecretKeys.filter((key) => {
    const value = sharedEnv.get(key);
    return value && value !== '';
  });
}

function main() {
  let sharedEnv;
  try {
    sharedEnv = parseEnvFile(envExamplePath);
    parseEnvFile(localEnvPath);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const missingShared = checkMissingSharedKeys(sharedEnv);
  if (missingShared.length > 0) {
    console.error(`Missing required keys in .env.example: ${missingShared.join(', ')}`);
    process.exit(1);
  }

  const leakedSecrets = checkLeakedSecrets(sharedEnv);
  if (leakedSecrets.length > 0) {
    console.error(
      `.env.example contains secret-bearing keys that should stay blank: ${leakedSecrets.join(', ')}`,
    );
    process.exit(1);
  }

  console.log('Environment files passed validation.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
