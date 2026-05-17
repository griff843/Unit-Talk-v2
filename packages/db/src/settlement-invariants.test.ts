/**
 * UTV2-938: Settlement correction invariant verification
 *
 * Verifies the corrects_id correction chain semantics enforced by
 * assertSettlementCorrectionReference and InMemorySettlementRepository.
 * Key invariants:
 *   - Original row is never mutated — corrections create new rows
 *   - Self-reference (corrects_id == new id) is rejected
 *   - corrects_id referencing non-existent record is rejected
 *   - Valid correction chains are accepted
 *   - listByPick returns all records (original + corrections)
 *
 * Run: npx tsx --test packages/db/src/settlement-invariants.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { assertSettlementCorrectionReference } from "./constraint-guards.js";
import { InMemorySettlementRepository } from "./runtime-repositories.js";
import type { SettlementCreateInput } from "./repositories.js";
import type { SettlementRecord } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(
  overrides: Partial<SettlementCreateInput> & { pickId: string },
): SettlementCreateInput {
  return {
    status: "settled",
    result: "won",
    source: "operator",
    confidence: "confirmed",
    evidenceRef: "game-123",
    settledBy: "grader",
    settledAt: new Date().toISOString(),
    payload: {},
    correctsId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// assertSettlementCorrectionReference
// ---------------------------------------------------------------------------

test("guard: null correctsId is a no-op", () => {
  assert.doesNotThrow(() =>
    assertSettlementCorrectionReference([], null, "s1"),
  );
});

test("guard: undefined correctsId is a no-op", () => {
  assert.doesNotThrow(() =>
    assertSettlementCorrectionReference([], undefined, "s1"),
  );
});

test("guard: self-reference throws", () => {
  assert.throws(
    () => assertSettlementCorrectionReference([], "s1", "s1"),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("cannot reference itself"));
      return true;
    },
  );
});

test("guard: non-existent corrects_id throws", () => {
  assert.throws(
    () => assertSettlementCorrectionReference([], "s_ghost", "s2"),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("does not reference an existing"));
      return true;
    },
  );
});

test("guard: valid corrects_id referencing existing record succeeds", () => {
  const existing = [{ id: "s1" } as SettlementRecord];
  assert.doesNotThrow(() =>
    assertSettlementCorrectionReference(existing, "s1", "s2"),
  );
});

// ---------------------------------------------------------------------------
// InMemorySettlementRepository: correction chain invariants
// ---------------------------------------------------------------------------

test("original row is never mutated — correction creates a new row", async () => {
  const repo = new InMemorySettlementRepository();
  const original = await repo.record(makeInput({ pickId: "p1" }));
  const originalResult = original.result;

  const correction = await repo.record(
    makeInput({ pickId: "p1", result: "lost", correctsId: original.id }),
  );

  assert.notEqual(correction.id, original.id, "correction must have different id");
  assert.equal(correction.corrects_id, original.id, "correction must reference original");

  const all = await repo.listByPick("p1");
  const foundOriginal = all.find((r) => r.id === original.id);
  assert.ok(foundOriginal, "original must still exist");
  assert.equal(foundOriginal.result, originalResult, "original result must be unchanged");
  assert.equal(foundOriginal.corrects_id, null, "original corrects_id must remain null");
});

test("listByPick returns all records: original and all corrections", async () => {
  const repo = new InMemorySettlementRepository();
  const original = await repo.record(makeInput({ pickId: "p2" }));
  const c1 = await repo.record(makeInput({ pickId: "p2", result: "push", correctsId: original.id }));
  const c2 = await repo.record(makeInput({ pickId: "p2", result: "won", correctsId: c1.id }));

  const all = await repo.listByPick("p2");
  assert.equal(all.length, 3);
  const ids = new Set(all.map((r) => r.id));
  assert.ok(ids.has(original.id));
  assert.ok(ids.has(c1.id));
  assert.ok(ids.has(c2.id));
});

test("findLatestForPick returns the correction, not the original", async () => {
  const repo = new InMemorySettlementRepository();
  const original = await repo.record(makeInput({ pickId: "p3" }));
  const correction = await repo.record(
    makeInput({
      pickId: "p3",
      result: "lost",
      correctsId: original.id,
      settledAt: new Date(Date.now() + 1000).toISOString(),
    }),
  );

  const latest = await repo.findLatestForPick("p3");
  assert.ok(latest);
  assert.equal(latest.id, correction.id, "latest must be the correction");
});

test("non-existent corrects_id is rejected at repository layer", async () => {
  const repo = new InMemorySettlementRepository();
  await assert.rejects(
    () => repo.record(makeInput({ pickId: "p4", correctsId: "settlement_ghost_9999" })),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("does not reference an existing"));
      return true;
    },
  );
});

test("findLatestForPick returns null for unknown pick", async () => {
  const repo = new InMemorySettlementRepository();
  assert.equal(await repo.findLatestForPick("unknown"), null);
});

test("listByPick returns empty array for unknown pick", async () => {
  const repo = new InMemorySettlementRepository();
  assert.deepEqual(await repo.listByPick("unknown"), []);
});

test("records do not bleed across pick IDs", async () => {
  const repo = new InMemorySettlementRepository();
  await repo.record(makeInput({ pickId: "pa" }));
  await repo.record(makeInput({ pickId: "pb" }));
  await repo.record(makeInput({ pickId: "pa", result: "push" }));

  const pa = await repo.listByPick("pa");
  const pb = await repo.listByPick("pb");
  assert.equal(pa.length, 2);
  assert.equal(pb.length, 1);
  assert.ok(pa.every((r) => r.pick_id === "pa"));
  assert.ok(pb.every((r) => r.pick_id === "pb"));
});
