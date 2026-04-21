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

    // Collaboration~Documents fields (e.g. Unit Talk/Description, Unit Talk/Notes) cannot
    // be selected via q/select or written via fibery.entity/update — skip them gracefully.
    if (isDocumentNoteField(config.note_field)) {
      await this.resolveEntity(config, publicId, []);
      return {
        entity_id: publicId,
        dry_run: false,
        operation: 'append_note',
        detail: `verified ${config.type} ${publicId}; ${config.note_field} is a Fibery document field, so primitive note append was skipped`,
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
    // postCommands unwraps envelopes; payload[0] is the result array.
    const firstResult = Array.isArray(payload[0]) ? (payload[0][0] as { 'fibery/id'?: string } | undefined) : undefined;
    if (typeof firstResult?.['fibery/id'] !== 'string') {
      throw new Error(`Fibery state "${stateName}" not found for ${entityType}`);
    }
    return firstResult['fibery/id'];
  }

  private async resolveEntity(
    config: FiberyEntityConfig,
    publicId: string,
    extraFields: string[],
  ): Promise<QueryEntity> {
    const entity = await this.queryEntity(config, publicId, extraFields);
    if (entity) {
      return entity;
    }

    const autoCreateTypes: Record<string, boolean> = {
      'Unit Talk/Issue': true,
      'Unit Talk/Proof Artifacts': true,
    };
    if (autoCreateTypes[config.type] && /^UTV2-\d+$/.test(publicId)) {
      await this.createIssueShell(config, publicId);
      const created = await this.queryEntity(config, publicId, extraFields);
      if (created) {
        return created;
      }
    }

    throw new Error(`Fibery entity not found: ${config.type} ${publicId}`);
  }

  private async queryEntity(
    config: FiberyEntityConfig,
    publicId: string,
    extraFields: string[],
  ): Promise<QueryEntity | null> {
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
    // postCommands unwraps the Fibery envelope, so payload[0] is the result array.
    const firstResult = Array.isArray(payload[0]) ? payload[0][0] : undefined;
    if (!isRecord(firstResult) || typeof firstResult['fibery/id'] !== 'string') {
      return null;
    }
    return firstResult as QueryEntity;
  }

  private async createIssueShell(config: FiberyEntityConfig, publicId: string): Promise<void> {
    await this.postCommands([
      {
        command: 'fibery.entity/create',
        args: {
          type: config.type,
          entity: {
            [config.lookup_field]: publicId,
            'Unit Talk/Name': `${publicId} - GitHub sync shell`,
          },
        },
      },
    ]);
  }

  private async queryWorkflowStateId(type: string, state: string): Promise<string> {
    const payload = await this.postCommands([
      {
        command: 'fibery.entity/query',
        args: {
          query: {
            'q/from': `workflow/state_${type}`,
            'q/select': ['fibery/id', 'enum/name'],
            'q/where': ['=', ['enum/name'], '$state'],
            'q/limit': 1,
          },
          params: {
            '$state': state,
          },
        },
      },
    ]);
    const firstResult = Array.isArray(payload[0]) ? payload[0][0] : undefined;
    if (!isRecord(firstResult) || typeof firstResult['fibery/id'] !== 'string') {
      throw new Error(`Fibery workflow state not found: ${type} ${state}`);
    }
    return firstResult['fibery/id'];
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
    // postCommands already throws on Fibery command failure; no additional check needed.
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
    return payload.map((entry) => {
      if (!isRecord(entry) || !('success' in entry)) {
        return entry;
      }
      if (entry.success !== true) {
        const error = isRecord(entry.error) && typeof entry.error.message === 'string'
          ? entry.error.message
          : JSON.stringify(entry.error ?? entry);
        throw new Error(`Fibery command failed: ${error}`);
      }
      return entry.result;
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDocumentNoteField(field: string): boolean {
  return field === 'Unit Talk/Description' || field === 'Unit Talk/Notes';
}
