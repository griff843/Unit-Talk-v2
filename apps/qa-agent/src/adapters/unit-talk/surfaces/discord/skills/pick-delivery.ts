import type { QASkill, SkillContext, SkillResult, StepResult, Severity } from '../../../../../core/types.js';
import {
  evaluateQaPersonaVisibility,
  fetchDiscordJson,
  type DiscordEmbed,
  type DiscordGuildChannel,
  type DiscordMessage,
  type DiscordRole,
  readQaEnv,
  requireQaDiscordContext,
} from './qa-sandbox.js';

type QaSeedResponse = {
  pickId: string;
  outboxId: string;
  channelId: string;
};

type QaPickStatusResponse = {
  pickId: string;
  status: string | null;
  outboxId: string | null;
  outboxStatus: string | null;
};

type PickDeliverySummary = {
  personaId: string;
  seededPickId?: string;
  outboxId?: string;
  channelId?: string;
  status: SkillResult['status'];
  vipCanViewVip: boolean;
  freeCanViewVip: boolean;
  freeCanViewFree: boolean;
  embedValidated: boolean;
  pickStatus?: QaPickStatusResponse;
  notes: string[];
};

const PICK_DELIVERY_COLOR = 5793266;
const PICK_DELIVERY_TIMEOUT_MS = 10_000;
const PICK_DELIVERY_POLL_MS = 500;
const QA_TEST_PICK_TITLE = 'QA Test Pick \u2014 Over 42.5';

export function buildPickDeliveryEmbed(): DiscordEmbed {
  return {
    title: QA_TEST_PICK_TITLE,
    fields: [
      { name: 'Odds', value: '-110', inline: true },
      { name: 'Units', value: '1', inline: true },
      { name: 'Book', value: 'QA Book', inline: true },
    ],
    color: PICK_DELIVERY_COLOR,
  };
}

export function embedHasRequiredFields(embed: DiscordEmbed | undefined): boolean {
  if (!embed?.title || embed.title !== QA_TEST_PICK_TITLE) {
    return false;
  }

  const fields = embed.fields ?? [];
  return (
    fields.some((field) => field.name === 'Odds' && field.value === '-110')
    && fields.some((field) => field.name === 'Units' && field.value === '1')
    && fields.some((field) => field.name === 'Book' && field.value === 'QA Book')
  );
}

async function fetchQaApiJson<T>(
  baseUrl: string,
  pathname: string,
  init?: { method?: 'GET' | 'POST' },
): Promise<T> {
  const response = await fetch(new URL(pathname, baseUrl), {
    method: init?.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`QA API request failed for ${pathname}: HTTP ${response.status}${detail ? ` ${detail}` : ''}`);
  }

  return response.json() as Promise<T>;
}

export async function pollForDiscordMessage(
  botToken: string,
  channelId: string,
  messageId: string,
  timeoutMs = PICK_DELIVERY_TIMEOUT_MS,
  pollMs = PICK_DELIVERY_POLL_MS,
): Promise<DiscordMessage> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const messages = await fetchDiscordJson<DiscordMessage[]>(
      botToken,
      `/channels/${channelId}/messages`,
    );
    const match = messages.find((message) => message.id === messageId);
    if (match) {
      return match;
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error(`Embed message ${messageId} did not appear in channel ${channelId} within ${timeoutMs}ms`);
}

function buildSummaryHtml(input: PickDeliverySummary): string {
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>Discord QA Pick Delivery</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; background: #111827; color: #f9fafb; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        th, td { border: 1px solid #374151; padding: 8px; text-align: left; }
        th { background: #1f2937; }
        .ok { color: #22c55e; }
        .bad { color: #ef4444; }
      </style>
    </head>
    <body>
      <h1>Discord QA Pick Delivery</h1>
      <p>Persona: ${input.personaId}</p>
      <p>Status: <span class="${input.status === 'PASS' ? 'ok' : 'bad'}">${input.status}</span></p>
      <table>
        <thead><tr><th>Check</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td>Seeded Pick</td><td>${input.seededPickId ?? 'n/a'}</td></tr>
          <tr><td>Outbox</td><td>${input.outboxId ?? 'n/a'}</td></tr>
          <tr><td>Delivery Channel</td><td>${input.channelId ?? 'n/a'}</td></tr>
          <tr><td>VIP sees #vip-picks</td><td>${input.vipCanViewVip}</td></tr>
          <tr><td>Free sees #vip-picks</td><td>${input.freeCanViewVip}</td></tr>
          <tr><td>Free sees #free-picks</td><td>${input.freeCanViewFree}</td></tr>
          <tr><td>Embed Validated</td><td>${input.embedValidated}</td></tr>
          <tr><td>QA pick status</td><td>${input.pickStatus ? `${input.pickStatus.status ?? 'null'} / ${input.pickStatus.outboxStatus ?? 'null'}` : 'n/a'}</td></tr>
        </tbody>
      </table>
      <ul>${input.notes.map((note) => `<li>${note}</li>`).join('')}</ul>
    </body>
  </html>`;
}

function pushStep(
  steps: StepResult[],
  step: string,
  status: 'pass' | 'fail' | 'skip',
  detail?: string,
): void {
  steps.push({
    step,
    status,
    ...(detail ? { detail } : {}),
    timestamp: new Date().toISOString(),
    durationMs: 0,
  });
}

function failResult(
  steps: StepResult[],
  severity: Severity,
  observations: string[],
  networkErrors: string[],
  consoleErrors: string[],
): SkillResult {
  return {
    status: 'FAIL',
    severity,
    steps,
    observations,
    networkErrors,
    consoleErrors,
    uxFriction: [],
  };
}

export const pickDeliverySkill: QASkill = {
  id: 'discord/pick-delivery',
  product: 'unit-talk',
  surface: 'discord',
  flow: 'pick_delivery',
  supportedPersonas: ['vip_user', 'free_user'],
  description: 'Discord sandbox pick-delivery: seed a QA pick, verify embed delivery, and assert VIP/free visibility rules',

  async run(ctx: SkillContext): Promise<SkillResult> {
    const steps: StepResult[] = [];
    const observations: string[] = [];
    const networkErrors: string[] = [];
    const consoleErrors: string[] = [];

    let summary: PickDeliverySummary = {
      personaId: ctx.persona.id,
      status: 'FAIL',
      vipCanViewVip: false,
      freeCanViewVip: false,
      freeCanViewFree: false,
      embedValidated: false,
      notes: [],
    };

    try {
      const { repoRoot, qaBotToken, qaGuildId, qaMap } = requireQaDiscordContext();
      const qaApiUrl = readQaEnv('UNIT_TALK_QA_API_URL', repoRoot)?.trim();

      if (!qaApiUrl) {
        pushStep(steps, 'Load QA API config', 'fail', 'UNIT_TALK_QA_API_URL is required.');
        return failResult(steps, 'high', observations, networkErrors, consoleErrors);
      }

      const [roles, channels] = await Promise.all([
        fetchDiscordJson<DiscordRole[]>(qaBotToken, `/guilds/${qaGuildId}/roles`),
        fetchDiscordJson<DiscordGuildChannel[]>(qaBotToken, `/guilds/${qaGuildId}/channels`),
      ]);
      pushStep(steps, 'Fetch sandbox guild metadata', 'pass', `Fetched ${roles.length} roles and ${channels.length} channels`);

      const vipEvaluation = evaluateQaPersonaVisibility({
        personaId: 'vip_user',
        guildId: qaGuildId,
        qaMap,
        roles,
        channels,
      });
      const freeEvaluation = evaluateQaPersonaVisibility({
        personaId: 'free_user',
        guildId: qaGuildId,
        qaMap,
        roles,
        channels,
      });

      const vipCanViewVip = vipEvaluation.snapshot.actualVisible.includes('vipPicks');
      const freeCanViewVip = freeEvaluation.snapshot.actualVisible.includes('vipPicks');
      const freeCanViewFree = freeEvaluation.snapshot.actualVisible.includes('freePicks');

      summary = {
        ...summary,
        vipCanViewVip,
        freeCanViewVip,
        freeCanViewFree,
      };

      pushStep(
        steps,
        'Assert VIP role can view #vip-picks',
        vipCanViewVip ? 'pass' : 'fail',
        vipCanViewVip ? 'VIP visibility confirmed' : 'VIP role cannot view #vip-picks',
      );
      pushStep(
        steps,
        'Assert free role cannot view #vip-picks',
        !freeCanViewVip ? 'pass' : 'fail',
        !freeCanViewVip ? 'Free role hidden from #vip-picks' : 'Free role can view #vip-picks',
      );
      pushStep(
        steps,
        'Assert free role can view #free-picks',
        freeCanViewFree ? 'pass' : 'fail',
        freeCanViewFree ? 'Free role can view #free-picks' : 'Free role cannot view #free-picks',
      );

      if (!vipCanViewVip || freeCanViewVip || !freeCanViewFree) {
        summary = {
          ...summary,
          status: 'FAIL',
          notes: ['Sandbox permission matrix does not satisfy VIP/free expectations.'],
        };
        await ctx.page.setContent(buildSummaryHtml(summary));
        await ctx.screenshot('discord-pick-delivery-access-fail');
        return failResult(steps, freeCanViewVip ? 'critical' : 'high', observations, networkErrors, consoleErrors);
      }

      if (ctx.persona.id === 'free_user') {
        summary = {
          ...summary,
          status: 'PASS',
          notes: ['Free-user sandbox visibility checks passed.'],
        };
        await ctx.page.setContent(buildSummaryHtml(summary));
        await ctx.screenshot('discord-pick-delivery-free-pass');
        return {
          status: 'PASS',
          steps,
          observations,
          networkErrors,
          consoleErrors,
          uxFriction: [],
        };
      }

      const seed = await fetchQaApiJson<QaSeedResponse>(qaApiUrl, '/api/qa/seed-pick', { method: 'POST' });
      pushStep(steps, 'Seed sandbox QA pick', 'pass', `pickId=${seed.pickId} outboxId=${seed.outboxId}`);
      summary = {
        ...summary,
        seededPickId: seed.pickId,
        outboxId: seed.outboxId,
        channelId: seed.channelId,
      };

      if (seed.channelId !== qaMap.channels.qaPickDelivery) {
        pushStep(
          steps,
          'Assert QA seed channel mapping',
          'fail',
          `Expected ${qaMap.channels.qaPickDelivery}, received ${seed.channelId}`,
        );
        summary = {
          ...summary,
          status: 'FAIL',
          notes: ['Seed endpoint returned the wrong QA delivery channel.'],
        };
        await ctx.page.setContent(buildSummaryHtml(summary));
        await ctx.screenshot('discord-pick-delivery-seed-channel-fail');
        return failResult(steps, 'high', observations, networkErrors, consoleErrors);
      }

      const createdMessage = await fetchDiscordJson<DiscordMessage>(
        qaBotToken,
        `/channels/${seed.channelId}/messages`,
        {
          method: 'POST',
          body: {
            embeds: [buildPickDeliveryEmbed()],
          },
        },
      );
      pushStep(steps, 'Post QA embed to #qa-pick-delivery', 'pass', `messageId=${createdMessage.id}`);

      const visibleMessage = await pollForDiscordMessage(qaBotToken, seed.channelId, createdMessage.id);
      const embedValidated = embedHasRequiredFields(visibleMessage.embeds?.[0]);
      summary = {
        ...summary,
        embedValidated,
      };

      pushStep(
        steps,
        'Poll #qa-pick-delivery for posted embed',
        embedValidated ? 'pass' : 'fail',
        embedValidated ? 'Embed found with required fields' : 'Embed is missing title, Odds, Units, or Book',
      );

      if (!embedValidated) {
        summary = {
          ...summary,
          status: 'FAIL',
          notes: ['Posted embed was missing one or more required fields.'],
        };
        await ctx.page.setContent(buildSummaryHtml(summary));
        await ctx.screenshot('discord-pick-delivery-embed-fail');
        return failResult(steps, 'high', observations, networkErrors, consoleErrors);
      }

      const pickStatus = await fetchQaApiJson<QaPickStatusResponse>(
        qaApiUrl,
        `/api/qa/pick-status/${seed.pickId}`,
      );
      summary = {
        ...summary,
        pickStatus,
      };

      const statusFieldsPresent = Boolean(pickStatus.status) && Boolean(pickStatus.outboxStatus);
      const outboxMatches = pickStatus.outboxId === seed.outboxId;
      pushStep(
        steps,
        'Verify QA pick status through API',
        statusFieldsPresent && outboxMatches ? 'pass' : 'fail',
        `status=${pickStatus.status ?? 'null'} outboxStatus=${pickStatus.outboxStatus ?? 'null'} outboxId=${pickStatus.outboxId ?? 'null'}`,
      );

      if (!statusFieldsPresent || !outboxMatches) {
        summary = {
          ...summary,
          status: 'FAIL',
          notes: ['QA pick status response did not match the seeded outbox record.'],
        };
        await ctx.page.setContent(buildSummaryHtml(summary));
        await ctx.screenshot('discord-pick-delivery-status-fail');
        return failResult(steps, 'high', observations, networkErrors, consoleErrors);
      }

      summary = {
        ...summary,
        status: 'PASS',
        notes: ['Sandbox embed delivery and VIP/free visibility checks passed.'],
      };
      await ctx.page.setContent(buildSummaryHtml(summary));
      await ctx.screenshot('discord-pick-delivery-pass');

      return {
        status: 'PASS',
        steps,
        observations,
        networkErrors,
        consoleErrors,
        uxFriction: [],
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      networkErrors.push(detail);
      pushStep(steps, 'Run Discord sandbox pick-delivery checks', 'fail', detail);
      summary = {
        ...summary,
        status: 'FAIL',
        notes: [detail],
      };
      await ctx.page.setContent(buildSummaryHtml(summary));
      await ctx.screenshot('discord-pick-delivery-error');
      return failResult(steps, 'high', observations, networkErrors, consoleErrors);
    }
  },
};
