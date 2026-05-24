/**
 * Provider quarantine registry — Gap #49 (UTV2-1087).
 *
 * Tracks providers that have been automatically quarantined after circuit breaker
 * health breach. Quarantine is in-memory and per-process; it survives across
 * ingest cycles within a single process run but resets on restart.
 */

export interface ProviderQuarantineRecord {
  providerKey: string;
  quarantinedAt: string;
  reason: string;
  failureCount: number;
  details: Record<string, unknown>;
}

export interface ProviderQuarantineEvent {
  event: 'quarantine' | 'release';
  providerKey: string;
  at: string;
  reason: string;
  details: Record<string, unknown>;
}

export class ProviderQuarantinedError extends Error {
  readonly providerKey: string;
  readonly quarantinedAt: string;

  constructor(record: ProviderQuarantineRecord) {
    super(
      `Provider ${record.providerKey} is quarantined since ${record.quarantinedAt}: ${record.reason}`,
    );
    this.name = 'ProviderQuarantinedError';
    this.providerKey = record.providerKey;
    this.quarantinedAt = record.quarantinedAt;
  }
}

export class ProviderQuarantineRegistry {
  private readonly records = new Map<string, ProviderQuarantineRecord>();
  private readonly logger: Pick<Console, 'info' | 'warn'> | undefined;

  constructor(options: { logger?: Pick<Console, 'info' | 'warn'> } = {}) {
    this.logger = options.logger;
  }

  quarantine(
    providerKey: string,
    reason: string,
    details: { failureCount?: number; [key: string]: unknown } = {},
  ): void {
    const { failureCount = 0, ...rest } = details;
    const existing = this.records.get(providerKey);
    const record =
      existing ??
      {
        providerKey,
        quarantinedAt: new Date().toISOString(),
        reason,
        failureCount,
        details: rest,
      };
    if (!existing) {
      this.records.set(providerKey, record);
    }

    const event: ProviderQuarantineEvent = {
      event: 'quarantine',
      providerKey,
      at: new Date().toISOString(),
      reason,
      details: {
        failureCount,
        ...rest,
        active: !existing,
        ...(existing ? { existingQuarantinedAt: existing.quarantinedAt } : {}),
      },
    };
    this.logger?.warn?.(JSON.stringify(event));
  }

  isQuarantined(providerKey: string): boolean {
    return this.records.has(providerKey);
  }

  getRecord(providerKey: string): ProviderQuarantineRecord | undefined {
    return this.records.get(providerKey);
  }

  assertAvailable(providerKey: string): void {
    const record = this.records.get(providerKey);
    if (record) {
      throw new ProviderQuarantinedError(record);
    }
  }

  release(providerKey: string, reason = 'manual_release'): void {
    const existing = this.records.get(providerKey);
    if (existing) {
      this.records.delete(providerKey);
    }

    const event: ProviderQuarantineEvent = {
      event: 'release',
      providerKey,
      at: new Date().toISOString(),
      reason,
      details: {
        released: existing !== undefined,
        ...(existing ? { quarantinedAt: existing.quarantinedAt } : {}),
      },
    };
    this.logger?.info?.(JSON.stringify(event));
  }

  listQuarantined(): ProviderQuarantineRecord[] {
    return Array.from(this.records.values());
  }
}
