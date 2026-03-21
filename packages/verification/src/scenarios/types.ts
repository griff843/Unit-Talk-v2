export type ScenarioMode = 'replay' | 'runtime' | 'hybrid';

export type VerificationStage =
  | 'validated'
  | 'queued'
  | 'posted'
  | 'settled';

export interface ScenarioDefinition {
  id: string;
  name: string;
  mode: ScenarioMode;
  fixturePath?: string;
  lifecycleStagesExpected: VerificationStage[];
  expectedAssertions: string[];
  tags: string[];
}
