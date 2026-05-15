type AgentName = 'claude' | 'codex';
type AgentEvent = 'complete' | 'fail' | 'input-needed';

type NotifyArgs = {
  agent: AgentName;
  event: AgentEvent;
  detail: string;
};

type DiscordEmbedPayload = {
  username: 'Unit Talk Ops';
  embeds: Array<{
    title: string;
    description: string;
    timestamp: string;
    color: number;
  }>;
};

const AGENTS = new Set<AgentName>(['claude', 'codex']);
const EVENTS = new Set<AgentEvent>(['complete', 'fail', 'input-needed']);
const EVENT_COLORS: Record<AgentEvent, number> = {
  complete: 0x00ff00,
  fail: 0xff0000,
  'input-needed': 0xffaa00,
};

function readArgValue(argv: string[], index: number, flag: string): { value: string; nextIndex: number } {
  const equalsIndex = flag.indexOf('=');
  if (equalsIndex >= 0) {
    return { value: flag.slice(equalsIndex + 1), nextIndex: index };
  }

  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }

  return { value, nextIndex: index + 1 };
}

function parseArgs(argv: string[]): NotifyArgs {
  const parsed: Partial<Record<keyof NotifyArgs, string>> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index] ?? '';
    const name = flag.split('=')[0];

    switch (name) {
      case '--agent':
      case '--event':
      case '--detail': {
        const key = name.slice(2) as keyof NotifyArgs;
        const result = readArgValue(argv, index, flag);
        parsed[key] = result.value;
        index = result.nextIndex;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${name}`);
    }
  }

  if (!parsed.agent || !AGENTS.has(parsed.agent as AgentName)) {
    throw new Error('Missing or invalid --agent. Expected claude or codex.');
  }

  if (!parsed.event || !EVENTS.has(parsed.event as AgentEvent)) {
    throw new Error('Missing or invalid --event. Expected complete, fail, or input-needed.');
  }

  return {
    agent: parsed.agent as AgentName,
    event: parsed.event as AgentEvent,
    detail: parsed.detail ?? '',
  };
}

function buildPayload(args: NotifyArgs): DiscordEmbedPayload {
  return {
    username: 'Unit Talk Ops',
    embeds: [
      {
        title: `[${args.agent}] ${args.event}`,
        description: args.detail,
        timestamp: new Date().toISOString(),
        color: EVENT_COLORS[args.event],
      },
    ],
  };
}

async function postWebhook(webhookUrl: string, payload: DiscordEmbedPayload): Promise<number> {
  let response: Response;

  try {
    response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    console.error('agent-notify: Discord webhook request failed');
    return 1;
  }

  if (!response.ok) {
    console.error(`agent-notify: Discord webhook returned HTTP ${response.status}`);
    return 1;
  }

  return 0;
}

async function main(): Promise<number> {
  const webhookUrl = process.env.DISCORD_OPS_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    return 0;
  }

  try {
    const args = parseArgs(process.argv.slice(2));
    return await postWebhook(webhookUrl, buildPayload(args));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error(`agent-notify: ${message}`);
    return 1;
  }
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch(() => {
    console.error('agent-notify: unexpected notification failure');
    process.exitCode = 1;
  });
