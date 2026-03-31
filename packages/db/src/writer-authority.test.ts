import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertFieldAuthority,
  getFieldAuthority,
  getWritableFields,
  UnauthorizedWriterError,
} from './writer-authority.js';

describe('writer-authority', () => {
  describe('assertFieldAuthority', () => {
    it('succeeds silently for authorized writes', () => {
      assert.doesNotThrow(() => assertFieldAuthority('status', 'promoter'));
      assert.doesNotThrow(() => assertFieldAuthority('status', 'settler'));
      assert.doesNotThrow(() => assertFieldAuthority('status', 'operator_override'));
      assert.doesNotThrow(() => assertFieldAuthority('posted_at', 'poster'));
      assert.doesNotThrow(() => assertFieldAuthority('settled_at', 'settler'));
      assert.doesNotThrow(() => assertFieldAuthority('submitted_by', 'submitter'));
      assert.doesNotThrow(() => assertFieldAuthority('promotion_target', 'promoter'));
    });

    it('throws UnauthorizedWriterError for unauthorized writes', () => {
      assert.throws(
        () => assertFieldAuthority('status', 'submitter'),
        (err: unknown) => {
          assert.ok(err instanceof UnauthorizedWriterError);
          assert.equal(err.field, 'status');
          assert.equal(err.writerRole, 'submitter');
          assert.deepEqual(err.allowedWriters, ['promoter', 'settler', 'operator_override']);
          return true;
        },
      );
    });

    it('throws for poster trying to write settled_at', () => {
      assert.throws(
        () => assertFieldAuthority('settled_at', 'poster'),
        (err: unknown) => {
          assert.ok(err instanceof UnauthorizedWriterError);
          assert.equal(err.field, 'settled_at');
          return true;
        },
      );
    });

    it('allows unregistered fields by default (fail-open)', () => {
      assert.doesNotThrow(() => assertFieldAuthority('some_unknown_field', 'submitter'));
      assert.doesNotThrow(() => assertFieldAuthority('metadata', 'promoter'));
    });
  });

  describe('getFieldAuthority', () => {
    it('returns authority entry for registered field', () => {
      const auth = getFieldAuthority('status');
      assert.ok(auth);
      assert.equal(auth.field, 'status');
      assert.deepEqual(auth.allowedWriters, ['promoter', 'settler', 'operator_override']);
      assert.equal(auth.immutableAfterSet, false);
    });

    it('returns authority entry with immutableAfterSet true', () => {
      const auth = getFieldAuthority('posted_at');
      assert.ok(auth);
      assert.equal(auth.immutableAfterSet, true);
    });

    it('returns undefined for unregistered field', () => {
      const auth = getFieldAuthority('nonexistent_field');
      assert.equal(auth, undefined);
    });
  });

  describe('getWritableFields', () => {
    it('returns correct fields for submitter', () => {
      const fields = getWritableFields('submitter');
      assert.deepEqual(fields, ['submitted_by']);
    });

    it('returns correct fields for promoter', () => {
      const fields = getWritableFields('promoter');
      assert.deepEqual(fields, ['status', 'promotion_target']);
    });

    it('returns correct fields for poster', () => {
      const fields = getWritableFields('poster');
      assert.deepEqual(fields, ['posted_at']);
    });

    it('returns correct fields for settler', () => {
      const fields = getWritableFields('settler');
      assert.deepEqual(fields, ['status', 'settled_at']);
    });

    it('returns all governed fields for operator_override', () => {
      const fields = getWritableFields('operator_override');
      assert.deepEqual(fields, ['status', 'promotion_target', 'posted_at', 'settled_at']);
    });
  });

  describe('UnauthorizedWriterError', () => {
    it('includes field, writerRole, and allowedWriters properties', () => {
      const err = new UnauthorizedWriterError('status', 'submitter', [
        'promoter',
        'settler',
        'operator_override',
      ]);
      assert.equal(err.name, 'UnauthorizedWriterError');
      assert.equal(err.field, 'status');
      assert.equal(err.writerRole, 'submitter');
      assert.deepEqual(err.allowedWriters, ['promoter', 'settler', 'operator_override']);
      assert.ok(err.message.includes('submitter'));
      assert.ok(err.message.includes('status'));
      assert.ok(err instanceof Error);
    });
  });
});
