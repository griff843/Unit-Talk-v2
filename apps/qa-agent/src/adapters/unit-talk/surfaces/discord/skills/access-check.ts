import type { QASkill, SkillContext, SkillResult, StepResult } from '../../../../../core/types.js';

/**
 * Discord free-user access check.
 *
 * Stub — full Discord UI testing requires:
 *   - DISCORD_QA_BOT_TOKEN: test bot token
 *   - DISCORD_QA_GUILD_ID: staging Discord server ID
 *   - Test user accounts with appropriate roles
 *
 * Will verify once credentials are available:
 *   - Free user sees only public channels
 *   - Free user cannot access #vip-picks or #vip-plus-picks
 *   - Free user sees upgrade prompts
 */
export const accessCheckSkill: QASkill = {
  id: 'discord/access-check',
  product: 'unit-talk',
  surface: 'discord',
  flow: 'access_check',
  supportedPersonas: ['free_user', 'trial_user'],
  description: 'Discord free-user access check: can only see public channels, no VIP content',

  async run(ctx: SkillContext): Promise<SkillResult> {
    const steps: StepResult[] = [];
    const uxFriction: string[] = [];

    const hasGuildId = !!process.env['DISCORD_QA_GUILD_ID'];
    const hasBotToken = !!process.env['DISCORD_QA_BOT_TOKEN'];

    if (!hasGuildId || !hasBotToken) {
      steps.push({
        step: 'Check for Discord QA credentials',
        status: 'skip',
        detail: 'DISCORD_QA_GUILD_ID and DISCORD_QA_BOT_TOKEN not set — skipping live Discord test',
        timestamp: new Date().toISOString(),
        durationMs: 0,
      });
      uxFriction.push(
        'Discord QA requires DISCORD_QA_GUILD_ID and DISCORD_QA_BOT_TOKEN. ' +
        'Set up a staging Discord server and test bot to enable this skill.',
      );
      await ctx.screenshot('00-discord-stub');

      return {
        status: 'NEEDS_REVIEW',
        steps,
        consoleErrors: [],
        networkErrors: [],
        uxFriction,
        issueRecommendation: {
          title: '[QA] Discord access-check skill needs credentials to run',
          severity: 'low',
          product: 'unit-talk',
          surface: 'discord',
          description:
            'The Discord access-check QA skill is stubbed pending staging server setup. ' +
            'A test Discord guild and bot token are required.',
          stepsToReproduce: [
            'Create a staging Discord server mirroring production channel structure',
            'Create a Discord bot with test-user impersonation capability',
            'Set DISCORD_QA_GUILD_ID and DISCORD_QA_BOT_TOKEN in qa-agent env',
          ],
          expectedBehavior: 'QA agent logs into Discord staging as free_user and verifies channel access',
          actualBehavior: 'Skill skipped due to missing credentials',
          screenshotPaths: [],
          labels: ['qa-agent', 'unit-talk', 'discord', 'severity-low', 'needs-setup'],
        },
        regressionRecommendation: 'Once credentials are available, convert to a full access-gate regression test',
      };
    }

    // Live path — navigate to staging guild
    const guildUrl = `https://discord.com/channels/${process.env['DISCORD_QA_GUILD_ID']}`;
    ctx.log('Navigate to Discord staging guild', `guild: ${process.env['DISCORD_QA_GUILD_ID']}`);

    try {
      await ctx.page.goto(guildUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      steps.push({ step: 'Navigate to Discord staging guild', status: 'pass', timestamp: new Date().toISOString(), durationMs: 0 });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      steps.push({ step: 'Navigate to Discord staging guild', status: 'fail', detail, timestamp: new Date().toISOString(), durationMs: 0 });
      await ctx.screenshot('error-discord-navigation');
      return {
        status: 'FAIL',
        severity: 'high',
        steps,
        consoleErrors: [],
        networkErrors: [],
        uxFriction,
        issueRecommendation: {
          title: '[QA] Discord staging guild unreachable',
          severity: 'high',
          product: 'unit-talk',
          surface: 'discord',
          description: `Could not navigate to Discord staging guild. Detail: ${detail}`,
          stepsToReproduce: [`Open ${guildUrl} in browser`],
          expectedBehavior: 'Discord staging guild loads',
          actualBehavior: detail,
          screenshotPaths: [],
          labels: ['qa-agent', 'unit-talk', 'discord', 'severity-high'],
        },
      };
    }

    await ctx.screenshot('01-discord-guild-loaded');
    steps.push({ step: 'TODO: verify free_user channel visibility', status: 'skip', detail: 'Implement after auth flow is wired', timestamp: new Date().toISOString(), durationMs: 0 });
    steps.push({ step: 'TODO: verify VIP channel is locked/hidden', status: 'skip', detail: 'Implement after auth flow is wired', timestamp: new Date().toISOString(), durationMs: 0 });

    return {
      status: 'NEEDS_REVIEW',
      steps,
      consoleErrors: [],
      networkErrors: [],
      uxFriction: ['Discord auth flow not yet wired — channel access checks are TODOs'],
    };
  },
};
