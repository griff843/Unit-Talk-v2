export interface HealthSignal {
  component: string;
  status: 'healthy' | 'degraded' | 'down';
  observedAt: string;
}
