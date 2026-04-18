import { z } from 'zod';

export const MARKET_TYPE_IDS = [
  'player-prop',
  'moneyline',
  'spread',
  'total',
  'team-total',
] as const;

export type MarketTypeId = (typeof MARKET_TYPE_IDS)[number];

export const MARKET_TYPE_LABELS: Record<MarketTypeId, string> = {
  'player-prop': 'Player Prop',
  moneyline: 'Moneyline',
  spread: 'Spread',
  total: 'Total',
  'team-total': 'Team Total',
};

export const betFormSchema = z
  .object({
    sport: z.string().min(1, 'Sport is required'),
    marketType: z.enum(MARKET_TYPE_IDS, { required_error: 'Market type is required' }),
    eventName: z.string().min(1, 'Matchup / event is required'),
    // Player prop fields
    playerName: z.string().optional(),
    statType: z.string().optional(),
    direction: z.enum(['over', 'under']).optional(),
    line: z.coerce.number().optional(),
    // Non-prop team/side fields
    team: z.string().optional(),
    // Common — sportsbook is warn-only per operator submission contract
    sportsbook: z.string().optional(),
    odds: z.coerce
      .number({ invalid_type_error: 'Odds must be a number' })
      .int('Odds must be a whole number')
      .refine((v) => v !== 0 && ((v >= 100 && v <= 50000) || (v <= -100 && v >= -50000)), {
        message: 'American odds: integer, \xB1100 to \xB150000 (e.g. -110 or +150)',
      }),
    units: z.coerce
      .number({ invalid_type_error: 'Units must be a number' })
      .min(0.5, 'Units must be at least 0.5')
      .max(5.0, 'Units cannot exceed 5.0'),
    capperConviction: z.coerce
      .number({ invalid_type_error: 'Conviction must be a number' })
      .int('Conviction must be a whole number')
      .min(1, 'Conviction must be between 1 and 10')
      .max(10, 'Conviction must be between 1 and 10'),
    // capper identity is derived from the bearer token on the server (UTV2-658)
    capper: z.string().optional(),
    gameDate: z.string().min(1, 'Date is required'),
  })
  .superRefine((data, ctx) => {
    if (data.marketType === 'player-prop') {
      if (!data.playerName?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Player name is required', path: ['playerName'] });
      }
      if (!data.statType?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Stat type is required', path: ['statType'] });
      }
      if (!data.direction) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Direction (over/under) is required', path: ['direction'] });
      }
      if (data.line === undefined || data.line === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Line is required', path: ['line'] });
      } else if (Math.abs(data.line) > 999.5) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Line must be between -999.5 and +999.5', path: ['line'] });
      }
    }

    if (data.marketType === 'spread') {
      if (!data.team?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Team is required', path: ['team'] });
      }
      if (data.line === undefined || data.line === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Line is required', path: ['line'] });
      } else if (Math.abs(data.line) > 999.5) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Line must be between -999.5 and +999.5', path: ['line'] });
      }
    }

    if (data.marketType === 'total') {
      if (!data.direction) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Direction (over/under) is required', path: ['direction'] });
      }
      if (data.line === undefined || data.line === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Line is required', path: ['line'] });
      } else if (Math.abs(data.line) > 999.5) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Line must be between -999.5 and +999.5', path: ['line'] });
      }
    }

    if (data.marketType === 'team-total') {
      if (!data.team?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Team is required', path: ['team'] });
      }
      if (!data.direction) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Direction (over/under) is required', path: ['direction'] });
      }
      if (data.line === undefined || data.line === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Line is required', path: ['line'] });
      } else if (Math.abs(data.line) > 999.5) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Line must be between -999.5 and +999.5', path: ['line'] });
      }
    }

    if (data.marketType === 'moneyline') {
      if (!data.team?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Team is required', path: ['team'] });
      }
    }
  });

export type BetFormValues = z.infer<typeof betFormSchema>;
