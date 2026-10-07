import {
  buildResultPresentation,
  type PresentationEmbed,
  type PresentationField,
  type SettledPresentationState,
} from './discord-presentation.js';

export interface RecapEmbedInput {
  market: string;
  selection: string;
  result: SettledPresentationState;
  stakeUnits: number | null;
  profitLossUnits: number | null;
  clvPercent: number | null;
  submittedBy: string;
  /** Source compatibility input; never rendered publicly. */
  confidence?: number | null | undefined;
  sport?: string | null | undefined;
  odds?: number | null | undefined;
  thumbnailUrl?: string | null | undefined;
  settledAt?: string | null | undefined;
  previousResult?: string | null | undefined;
  correctedResult?: 'win' | 'loss' | 'push' | 'void' | null | undefined;
}
export type RecapEmbedField = PresentationField;
export type RecapEmbedData = PresentationEmbed;
export function buildRecapEmbedData(input: RecapEmbedInput): RecapEmbedData {
  return buildResultPresentation({
    ...input,
    capper: input.submittedBy,
    timestamp: input.settledAt,
  });
}
