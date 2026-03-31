import type { WriterRole } from '@unit-talk/contracts';

export interface FieldAuthority {
  field: string;
  allowedWriters: WriterRole[];
  immutableAfterSet: boolean;
}

export class UnauthorizedWriterError extends Error {
  readonly field: string;
  readonly writerRole: WriterRole;
  readonly allowedWriters: WriterRole[];

  constructor(field: string, writerRole: WriterRole, allowedWriters: WriterRole[]) {
    super(
      `Writer role '${writerRole}' is not authorized to write field '${field}'. Allowed: ${allowedWriters.join(', ')}`,
    );
    this.name = 'UnauthorizedWriterError';
    this.field = field;
    this.writerRole = writerRole;
    this.allowedWriters = allowedWriters;
  }
}

const FIELD_AUTHORITIES: FieldAuthority[] = [
  {
    field: 'status',
    allowedWriters: ['promoter', 'settler', 'operator_override'],
    immutableAfterSet: false,
  },
  {
    field: 'promotion_target',
    allowedWriters: ['promoter', 'operator_override'],
    immutableAfterSet: false,
  },
  {
    field: 'posted_at',
    allowedWriters: ['poster', 'operator_override'],
    immutableAfterSet: true,
  },
  {
    field: 'settled_at',
    allowedWriters: ['settler', 'operator_override'],
    immutableAfterSet: true,
  },
  {
    field: 'submitted_by',
    allowedWriters: ['submitter'],
    immutableAfterSet: true,
  },
];

/**
 * Returns the authority entry for a field, or undefined if the field is not registered.
 */
export function getFieldAuthority(field: string): FieldAuthority | undefined {
  return FIELD_AUTHORITIES.find((fa) => fa.field === field);
}

/**
 * Asserts that the given writer role is authorized to write the given field.
 * Throws UnauthorizedWriterError if the role is not in the allowed list.
 * Unregistered fields are allowed by default (fail-open).
 */
export function assertFieldAuthority(field: string, writerRole: WriterRole): void {
  const authority = getFieldAuthority(field);
  if (!authority) {
    return; // fail-open for unregistered fields
  }
  if (!authority.allowedWriters.includes(writerRole)) {
    throw new UnauthorizedWriterError(field, writerRole, authority.allowedWriters);
  }
}

/**
 * Returns all fields that the given writer role is authorized to write.
 */
export function getWritableFields(writerRole: WriterRole): string[] {
  return FIELD_AUTHORITIES.filter((fa) => fa.allowedWriters.includes(writerRole)).map(
    (fa) => fa.field,
  );
}
