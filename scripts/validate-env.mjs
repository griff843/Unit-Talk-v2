import fs from 'node:fs';
import path from 'node:path';

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

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing env file: ${path.basename(filePath)}`);
  }

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

const sharedEnv = parseEnvFile(envExamplePath);
parseEnvFile(localEnvPath);

const missingShared = requiredSharedKeys.filter((key) => !sharedEnv.has(key));
if (missingShared.length > 0) {
  console.error(`Missing required keys in .env.example: ${missingShared.join(', ')}`);
  process.exit(1);
}

const leakedSecrets = discouragedSharedSecretKeys.filter((key) => {
  const value = sharedEnv.get(key);
  return value && value !== '';
});

if (leakedSecrets.length > 0) {
  console.error(
    `.env.example contains secret-bearing keys that should stay blank: ${leakedSecrets.join(', ')}`,
  );
  process.exit(1);
}

console.log('Environment files passed validation.');
