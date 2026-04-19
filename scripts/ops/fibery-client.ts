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

    // note_field is Collaboration~Documents/Document — not a primitive, cannot be
    // selected via q/select or written via fibery.entity/update.
    // Use the REST document API instead: GET/PUT /api/documents/<fibery-id>.
    const entity = await this.resolveEntity(config, publicId, []);
    const fiberyId = entity['fibery/id'];
    if (typeof fiberyId !== 'string') {
      throw new Error(`Fibery entity ${publicId} missing fibery/id`);
    }

    const doc = await this.getDocument(fiberyId);
    const currentContent = doc.content ?? '';
    const nextContent = currentContent.trim()
      ? `${currentContent}${separator}${note}`
      : note;
    await this.putDocument(doc.secret, nextContent);

    return {
      entity_id: publicId,
      dry_run: false,
      operation: 'append_note',
      detail: `appended note to ${config.type} ${publicId} via document REST API`,
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

    // workflow/state is a relation — resolve the state entity ID by name first.
    // State type name follows the pattern: workflow/state_{entity-type}
    const entity = await this.resolveEntity(config, publicId, []);
    const stateId = await this.resolveStateId(config.type, state);
    await this.updateEntity(config.type, entity, {
      [config.state_field]: { 'fibery/id': stateId },
    });
    return {
      entity_id: publicId,
      dry_run: false,
      operation: 'set_state',
      detail: `set ${config.type} ${publicId} to ${state}`,
    };
  }

  private async resolveStateId(entityType: string, stateName: string): Promise<string> {
    const stateType = `workflow/state_${entityType}`;
    const payload = await this.postCommands([
      {
        command: 'fibery.entity/query',
        args: {
          query: {
            'q/from': stateType,
            'q/select': ['fibery/id', 'enum/name'],
            'q/where': ['=', ['enum/name'], '$name'],
            'q/limit': 1,
          },
          params: { '$name': stateName },
        },
      },
    ]);
    const envelope = payload[0] as { success?: boolean; result?: unknown[] } | undefined;
    if (!envelope?.success || !Array.isArray(envelope.result) || envelope.result.length === 0) {
      throw new Error(`Fibery state "${stateName}" not found for ${entityType}`);
    }
    const stateEntity = envelope.result[0] as { 'fibery/id'?: string } | undefined;
    if (typeof stateEntity?.['fibery/id'] !== 'string') {
      throw new Error(`Fibery state "${stateName}" missing fibery/id for ${entityType}`);
    }
    return stateEntity['fibery/id'];
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
    // Fibery returns [{ success, result: [...entities] }] — one envelope per command.
    const envelope = payload[0] as { success?: boolean; result?: unknown[] } | undefined;
    if (!envelope?.success) {
      throw new Error(`Fibery entity not found: ${config.type} ${publicId}`);
    }
    const firstResult = Array.isArray(envelope.result) ? envelope.result[0] : undefined;
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
    const payload = await this.postCommands([
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
    const envelope = payload[0] as { success?: boolean; result?: unknown } | undefined;
    if (!envelope?.success) {
      throw new Error(`Fibery entity update failed for ${type} ${String(id)}`);
    }
  }

  private async getDocument(fiberyId: string): Promise<{ secret: string; content: string }> {
    const response = await fetch(`${this.apiUrl}/api/documents/${fiberyId}`, {
      headers: { Authorization: `Token ${this.token}` },
    });
    if (!response.ok) {
      throw new Error(`Fibery document read failed: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as { secret: string; content: string };
  }

  private async putDocument(secret: string, content: string): Promise<void> {
    const response = await fetch(`${this.apiUrl}/api/documents/${secret}`, {
      method: 'PUT',
      headers: {
        Authorization: `Token ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) {
      throw new Error(`Fibery document write failed: ${response.status} ${response.statusText}`);
    }
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
