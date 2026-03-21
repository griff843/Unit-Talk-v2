type DomainEvent<TPayload = unknown> = {
  name: string;
  payload: TPayload;
  occurredAt: string;
};

export function createDiscordReceiptEvent(): DomainEvent<{ receipt: 'placeholder' }> {
  return {
    name: 'distribution.receipt.created',
    payload: { receipt: 'placeholder' },
    occurredAt: new Date().toISOString(),
  };
}

console.log(JSON.stringify(createDiscordReceiptEvent(), null, 2));
