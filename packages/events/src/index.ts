export interface DomainEvent<TPayload = unknown> {
  name: string;
  payload: TPayload;
  occurredAt: string;
}
