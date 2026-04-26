import type { QASkill, SkillContext, SkillResult, StepResult } from '../../../../../core/types.js';

/**
 * Discord VIP pick-delivery check.
 *
 * Stub — requires staging Discord environment + pick seeding API.
 *
 * Will verify once infrastructure is ready:
 *   - VIP user can see #vip-picks channel
 *   - A promoted pick appears in #vip-picks within SLA
 *   - Pick message has correct format (title, odds, units, book)
 *   - Free user cannot see the same channel
 *   - Delivery confirmation recorded in audit log
 */
export const pickDeliverySkill: QASkill = {
  id: 'discord/pick-delivery',
  product: 'unit-talk',
  surface: 'discord',
  flow: 'pick_delivery',
  supportedPersonas: ['vip_user', 'vip_plus_user'],
  description: 'Discord VIP pick-delivery: pick appears in #vip-picks within SLA, message format correct',

  async run(ctx: SkillContext): Promise<SkillResult> {
    const steps: StepResult[] = [];

    const skip = (name: string, reason: string) =>
      steps.push({ step: name, status: 'skip', detail: reason, timestamp: new Date().toISOString(), durationMs: 0 });

    skip('Authenticate as VIP user in Discord staging', 'Pending: DISCORD_QA_BOT_TOKEN');
    skip('Navigate to #vip-picks channel', 'Pending: DISCORD_QA_GUILD_ID + channel ID');
    skip('Trigger pick promotion in staging API', 'Pending: staging test pick seeding');
    skip('Verify pick message appears within 30s SLA', 'Pending: Discord auth + pick seeding');
    skip('Verify pick message format (title, odds, units, book)', 'Pending: Discord auth');
    skip('Switch to free_user and verify #vip-picks is hidden', 'Pending: Discord auth');

    await ctx.screenshot('00-pick-delivery-stub');

    return {
      status: 'NEEDS_REVIEW',
      steps,
      consoleErrors: [],
      networkErrors: [],
      uxFriction: [
        'Discord pick-delivery skill is a stub. Required: staging Discord guild, bot token, and pick seeding API.',
      ],
      issueRecommendation: {
        title: '[QA] Discord pick-delivery skill needs staging infrastructure',
        severity: 'medium',
        product: 'unit-talk',
        surface: 'discord',
        description:
          'The pick-delivery QA skill requires a full staging Discord environment. ' +
          'This is a foundational QA gap for the Discord delivery pipeline.',
        stepsToReproduce: [
          'Set up Discord staging server with #vip-picks and #vip-plus-picks channels',
          'Configure bot with role assignment and message read permissions',
          'Create pick seeding endpoint in staging API',
          'Implement Discord login flow in QA agent auth module',
        ],
        expectedBehavior: 'QA agent verifies end-to-end pick delivery to Discord channels with role gating',
        actualBehavior: 'Skill skipped — infrastructure not ready',
        screenshotPaths: [],
        labels: ['qa-agent', 'unit-talk', 'discord', 'severity-medium', 'needs-setup', 'delivery'],
      },
    };
  },
};
