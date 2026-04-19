export type FiberyEntityConfig = {
  type: string;
  lookup_field: string;
  note_field: string;
  state_field?: string;
};

export type FiberyClientOptions = {
  apiUrl: string;
  token: string;
  dryRun?: boolean;
};

type CommandPayload = Array<{
  command: string;
  args: Record<string, unknown>;
}>;

type QueryEntity = Record<string, unknown> & {
  'fibery/id'?: string;
};

export type FiberyOperationResult = {
  entity_id: string;
  dry_run: boolean;
  operation: 'append_note' | 'set_state';
  detail: string;
};

export class FiberyClient {
  private readonly apiUrl: string;
  private readonly token: string;
  private readonly dryRun: boolean;

  constructor(options: FiberyClientOptions) {
    this.apiUrl = options.apiUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.dryRun = options.dryRun ?? false;
  }

  async appendNote(
    config: FiberyEntityConfig,
    publicId: string,
    note: string,
    separator: string,
  ): Promise<FiberyOperationResult> {
    if (this.dryRun) {
      return {
        entity_id: publicId,
        dry_run: true,
        operation: 'append_note',
        detail: `would append note to ${config.type} ${publicId}`,
      };
    }

    const entity = await this.resolveEntity(config, publicId, [config.note_field]);
    const currentNote = typeof entity[config.note_field] === 'string' ? entity[config.note_field] : '';
    const nextNote = currentNote.trim().length > 0 ? `${currentNote}${separator}${note}` : note;
    await this.updateEntity(config.type, entity, { [config.note_field]: nextNote });
    return {
      entity_id: publicId,
      dry_run: false,
      operation: 'append_note',
      detail: `appended note to ${config.type} ${publicId}`,
    };
  }

  async setState(
    config: FiberyEntityConfig,
    publicId: string,
    state: string,
  ): Promise<FiberyOperationResult> {
    if (!config.state_field) {
      throw new Error(`No state_field configured for ${config.type}`);
    }
    if (this.dryRun) {
      return {
        entity_id: publicId,
        dry_run: true,
        operation: 'set_state',
        detail: `would set ${config.type} ${publicId} to ${state}`,
      };
    }

    const entity = await this.resolveEntity(config, publicId, []);
    await this.updateEntity(config.type, entity, { [config.state_field]: state });
    return {
      entity_id: publicId,
      dry_run: false,
      operation: 'set_state',
      detail: `set ${config.type} ${publicId} to ${state}`,
    };
  }

  private async resolveEntity(
    config: FiberyEntityConfig,
    publicId: string,
    extraFields: string[],
  ): Promise<QueryEntity> {
    const fields = ['fibery/id', config.lookup_field, ...extraFields];
    const payload = await this.postCommands([
      {
        command: 'fibery.entity/query',
        args: {
          query: {
            'q/from': config.type,
            'q/select': fields,
            'q/where': ['=', [config.lookup_field], '$publicId'],
            'q/limit': 1,
          },
          params: {
            '$publicId': publicId,
          },
        },
      },
    ]);
    const firstResult = Array.isArray(payload[0]) ? payload[0][0] : undefined;
    if (!isRecord(firstResult) || typeof firstResult['fibery/id'] !== 'string') {
      throw new Error(`Fibery entity not found: ${config.type} ${publicId}`);
    }
    return firstResult as QueryEntity;
  }

  private async updateEntity(
    type: string,
    entity: QueryEntity,
    fields: Record<string, unknown>,
  ): Promise<void> {
    const id = entity['fibery/id'];
    if (!id) {
      throw new Error(`Cannot update ${type}: missing fibery/id`);
    }
    await this.postCommands([
      {
        command: 'fibery.entity/update',
        args: {
          type,
          entity: {
            'fibery/id': id,
            ...fields,
          },
        },
      },
    ]);
  }

  private async postCommands(commands: CommandPayload): Promise<unknown[]> {
    const response = await fetch(`${this.apiUrl}/api/commands`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
    });
    if (!response.ok) {
      throw new Error(`Fibery API failed: ${response.status} ${response.statusText}`);
    }
    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      throw new Error('Fibery API returned a non-array response');
    }
    return payload;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
