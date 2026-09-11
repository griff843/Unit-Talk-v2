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
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { assertSettlementCorrectionReference } from "./constraint-guards.js";
import {
  InMemorySettlementRepository,
  SETTLEMENT_BATCH_CHUNK_SIZE,
  SETTLEMENT_BATCH_ID_URL_COST_BYTES,
  SETTLEMENT_BATCH_URL_BUDGET_BYTES,
  collectLatestSettlementsByPick,
} from "./runtime-repositories.js";
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

// ---------------------------------------------------------------------------
// UTV2-1886: batch settlement lookup
// ---------------------------------------------------------------------------

function settlementRow(
  id: string,
  pickId: string,
  createdAt: string,
): SettlementRecord {
  return {
    id,
    pick_id: pickId,
    status: "settled",
    result: "win",
    source: "test",
    confidence: "1",
    evidence_ref: "test",
    notes: null,
    review_reason: null,
    settled_by: "test",
    settled_at: createdAt,
    corrects_id: null,
    payload: {},
    created_at: createdAt,
    stake_units: null,
  } as SettlementRecord;
}

test("collectLatestSettlementsByPick reads every page of a chunk, not just the first", async () => {
  // One pick id, more settlement rows than a single page holds. A single-page read
  // would stop at the page boundary and miss the rows behind it -- and because an
  // absent key means "no settlement exists", missing rows is the fail-open direction.
  const pageSize = 10;
  const rows = Array.from({ length: 25 }, (_, index) =>
    settlementRow(
      `s${String(index).padStart(3, "0")}`,
      "pick-1",
      `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    ),
  ).sort((left, right) => right.created_at.localeCompare(left.created_at));

  const requested: Array<{ offset: number; limit: number }> = [];
  const latest = await collectLatestSettlementsByPick(
    ["pick-1"],
    async (_chunk, offset, limit) => {
      requested.push({ offset, limit });
      return rows.slice(offset, offset + limit);
    },
    { chunkSize: 500, pageSize },
  );

  assert.deepEqual(
    requested.map((entry) => entry.offset),
    [0, 10, 20],
  );
  // The newest row is s024 (2026-09-25). It sits on the first page under this
  // ordering, so the control below is what proves the later pages were really read.
  assert.equal(latest.get("pick-1")?.id, "s024");
  assert.equal(requested.length, 3);
});

test("collectLatestSettlementsByPick splits the id list into chunks", async () => {
  const ids = Array.from({ length: 1200 }, (_, index) => `pick-${index}`);
  const chunks: number[] = [];

  await collectLatestSettlementsByPick(
    ids,
    async (chunk) => {
      chunks.push(chunk.length);
      return [];
    },
    { chunkSize: 500, pageSize: 1000 },
  );

  assert.deepEqual(chunks, [500, 500, 200]);
});

test("collectLatestSettlementsByPick performs no read for an empty id list", async () => {
  let calls = 0;
  const latest = await collectLatestSettlementsByPick([], async () => {
    calls += 1;
    return [];
  });

  assert.equal(calls, 0);
  assert.equal(latest.size, 0);
});

test("collectLatestSettlementsByPick returns the correction, not the original, and omits picks with no settlement", async () => {
  const original = settlementRow("s1", "p1", "2026-09-01T00:00:00.000Z");
  const correction: SettlementRecord = {
    ...settlementRow("s2", "p1", "2026-09-02T00:00:00.000Z"),
    corrects_id: "s1",
  };
  const other = settlementRow("s3", "p2", "2026-09-01T00:00:00.000Z");

  const latest = await collectLatestSettlementsByPick(
    ["p1", "p2", "p3"],
    async () => [original, correction, other],
    { chunkSize: 500, pageSize: 1000 },
  );

  assert.equal(latest.get("p1")?.id, "s2");
  assert.equal(latest.get("p2")?.id, "s3");
  assert.equal(latest.has("p3"), false);
});

test("collectLatestSettlementsByPick breaks a created_at tie on id, in either page order", async () => {
  // `created_at` is not unique: a correction written in the same millisecond as the row
  // it corrects ties, and `compareSettlementRecordsDescending` breaks that tie on `id`.
  // A reduction that compares `created_at` alone keeps whichever row the page happened
  // to yield first, so the batch path and `findLatestForPick` would disagree about which
  // settlement is current -- for one pick, silently, depending on read order. Both
  // orderings are asserted because a one-order test passes by luck half the time.
  const tied = "2026-09-01T00:00:00.000Z";
  const lower = settlementRow("s1", "p1", tied);
  const higher = settlementRow("s2", "p1", tied);

  for (const page of [
    [lower, higher],
    [higher, lower],
  ]) {
    const latest = await collectLatestSettlementsByPick(
      ["p1"],
      async () => page,
      { chunkSize: 500, pageSize: 1000 },
    );
    assert.equal(
      latest.get("p1")?.id,
      "s2",
      `tie must resolve to the higher id regardless of page order (${page
        .map((row) => row.id)
        .join(",")})`,
    );
  }
});

test("InMemorySettlementRepository: findLatestForPicks agrees with findLatestForPick across the population", async () => {
  const repo = new InMemorySettlementRepository();
  const pickIds = ["p1", "p2", "p3"];

  await repo.record(makeInput({ pickId: "p1", settledAt: "2026-09-01T00:00:00.000Z" }));
  const second = await repo.record(
    makeInput({ pickId: "p1", settledAt: "2026-09-02T00:00:00.000Z" }),
  );
  await repo.record(makeInput({ pickId: "p2", settledAt: "2026-09-01T00:00:00.000Z" }));

  const batch = await repo.findLatestForPicks([...pickIds, "unknown"]);

  for (const pickId of pickIds) {
    const single = await repo.findLatestForPick(pickId);
    assert.deepEqual(batch.get(pickId) ?? null, single);
  }
  assert.equal(batch.get("p1")?.id, second.id);
  assert.equal(batch.has("p3"), false);
  assert.equal(batch.has("unknown"), false);
});

// ---------------------------------------------------------------------------
// UTV2-1886: the chunk size is a URL byte budget, asserted against the real
// query builder
//
// `pick_id=in.(...)` travels in the request LINE. Supabase fronts PostgREST with
// a proxy whose request line must fit a single 8 KiB header buffer, so a chunk
// that is correct as logic can still be refused as bytes -- with a 414 that no
// amount of unit testing against an injected fetcher would ever surface. These
// assertions build the actual URL `DatabaseSettlementRepository.findLatestForPicks`
// issues and measure it, so the constant cannot drift away from the limit it
// exists to respect.
// ---------------------------------------------------------------------------

/**
 * The exact query shape of `DatabaseSettlementRepository.findLatestForPicks`.
 * postgrest-js exposes the built URL before the request is sent, so this needs
 * no network, no credentials and no live database -- it is a byte measurement,
 * not a round trip.
 */
function settlementBatchQueryUrl(idCount: number): string {
  const client = createClient(
    "https://zfzdnfwdarxucxtaojxm.supabase.co",
    "anon-key-placeholder",
  );
  const ids = Array.from({ length: idCount }, () => randomUUID());
  const builder = client
    .from("settlement_records")
    .select()
    .in("pick_id", ids)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(0, 999);

  return String((builder as unknown as { url: URL }).url);
}

test("UTV2-1886: a full chunk's PostgREST URL fits the byte budget", () => {
  const bytes = Buffer.byteLength(
    settlementBatchQueryUrl(SETTLEMENT_BATCH_CHUNK_SIZE),
    "utf8",
  );

  assert.ok(
    bytes <= SETTLEMENT_BATCH_URL_BUDGET_BYTES,
    `a full chunk of ${SETTLEMENT_BATCH_CHUNK_SIZE} ids builds a ${bytes}-byte URL, ` +
      `over the ${SETTLEMENT_BATCH_URL_BUDGET_BYTES}-byte budget`,
  );
});

test("UTV2-1886: the budget is under the 8 KiB proxy request-line limit, and the previous chunk size was not", () => {
  // Non-vacuity in both directions. Without the first assertion the budget could
  // be raised past the limit and the test above would still pass; without the
  // second, a budget so small that no chunk size could ever fail would also pass
  // and prove nothing. 500 was this file's shipped chunk size before UTV2-1886
  // measured it: it builds a URL more than twice the proxy's limit.
  const PROXY_REQUEST_LINE_LIMIT_BYTES = 8192;

  assert.ok(
    SETTLEMENT_BATCH_URL_BUDGET_BYTES <= PROXY_REQUEST_LINE_LIMIT_BYTES / 2,
    "the budget must leave at least half the proxy request-line limit as headroom",
  );

  const previousChunkBytes = Buffer.byteLength(settlementBatchQueryUrl(500), "utf8");
  assert.ok(
    previousChunkBytes > PROXY_REQUEST_LINE_LIMIT_BYTES,
    `the 500-id chunk this lane replaced must exceed the ${PROXY_REQUEST_LINE_LIMIT_BYTES}-byte ` +
      `proxy limit, else the budget is measuring nothing; measured ${previousChunkBytes}`,
  );
});

test("UTV2-1886: the per-id URL cost constant matches what the query builder actually emits", () => {
  // The chunk size is computed FROM this constant, so a drift here silently
  // resizes the chunk. Measured as a difference so the fixed base URL cancels.
  const small = Buffer.byteLength(settlementBatchQueryUrl(10), "utf8");
  const large = Buffer.byteLength(settlementBatchQueryUrl(110), "utf8");
  const measuredCost = (large - small) / 100;

  assert.equal(
    measuredCost,
    SETTLEMENT_BATCH_ID_URL_COST_BYTES,
    `each additional pick id costs ${measuredCost} URL bytes, not the ` +
      `${SETTLEMENT_BATCH_ID_URL_COST_BYTES} the chunk size is derived from`,
  );
});
