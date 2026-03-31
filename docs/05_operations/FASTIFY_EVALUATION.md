# Fastify / Server Framework Evaluation

> UTV2-152 — T3 evaluation
> Produced: 2026-03-31
> Status: **EVALUATION COMPLETE — RECOMMEND: DO NOT MIGRATE NOW**

---

## 1. Current State

Both `apps/api` and `apps/operator-web` use raw `node:http` servers with hand-written routing.

| Metric | API | Operator-Web |
|---|---|---|
| server.ts lines | 477 | 2,177 |
| Route files | 8 modules in `src/routes/` | 18 modules in `src/routes/` |
| Route count | 18 method+path matches | 16 path matches |
| Body parsing | Custom `readJsonBody()` with size limit | N/A (read-only) |
| Error handling | Custom `ApiRequestError` class | `writeJson()` error responses |
| Rate limiting | In-memory `ApiRateLimitStore` | None (internal only) |
| Validation | Manual coercion in handlers | Manual coercion in handlers |
| Middleware | None (manual per-route) | None (manual per-route) |

### What's Hand-Rolled

1. **Body parsing** — `readJsonBody()` with configurable size limit, chunked reads, JSON.parse
2. **Error serialization** — `ApiRequestError` with code/message, caught in top-level handler
3. **Route matching** — if/else chain on `method === 'GET' && url.pathname === '/path'`
4. **Rate limiting** — `InMemoryApiRateLimitStore` with per-IP sliding window
5. **CORS** — not implemented (internal services only)
6. **Response helpers** — `writeJson()`, `writeHtml()`

---

## 2. What Fastify Would Provide

| Feature | Benefit | Current Gap Severity |
|---|---|---|
| Schema-based validation (JSON Schema / TypeBox) | Auto-validate request body, query, params | **Low** — validation is simple, few public inputs |
| Serialization optimization | Fast JSON serialization via `fast-json-stringify` | **Low** — response payloads are small |
| Plugin ecosystem | Rate limiting, CORS, helmet, compress | **Low** — only rate limiting is needed, already built |
| Route organization | Decorators, prefixes, encapsulation | **Medium** — already solved via route modules |
| Error handling | Structured error replies, schema-aware | **Low** — `ApiRequestError` works fine |
| TypeScript integration | Typed routes with generics | **Medium** — would improve DX |
| Performance | ~2x faster than Express, on par with raw http | **None** — raw http is already fastest |

---

## 3. Migration Cost

### API (apps/api)

| Task | Effort | Risk |
|---|---|---|
| Replace `createApiServer()` with Fastify instance | Medium | Low |
| Convert 8 route modules to Fastify route plugins | Medium | Medium — test compatibility |
| Replace `readJsonBody()` with Fastify body parser | Low | Low |
| Replace `ApiRequestError` with Fastify error handler | Low | Low |
| Replace `InMemoryApiRateLimitStore` with `@fastify/rate-limit` | Low | Low |
| Update all 30+ API tests that use raw `http.request` | **High** | **High** — largest effort |
| Wire Fastify into `index.ts` startup/shutdown | Low | Low |

**Estimated total: 2-3 days of focused work.**

### Operator-Web (apps/operator-web)

| Task | Effort | Risk |
|---|---|---|
| Replace `createOperatorServer()` with Fastify instance | Medium | Low |
| Convert 18 route modules to Fastify route plugins | High | Medium |
| Replace `writeJson()`/`writeHtml()` with Fastify replies | Medium | Low |
| Update 84+ operator-web tests | **Very High** | **High** |
| Handle `_supabaseClient` provider pattern | Medium | Medium |

**Estimated total: 3-4 days of focused work.**

### Combined: ~5-7 days, touching every test file in both apps.

---

## 4. Risk Assessment

| Risk | Severity | Notes |
|---|---|---|
| Test rewrite volume | **High** | 114+ tests use raw `http.request()` and `createOperatorServer()` |
| Runtime behavior change | **Medium** | Fastify has different error response shapes, header defaults, and body parsing behavior |
| Dependency surface increase | **Low** | Fastify + 2-3 plugins vs 0 dependencies today |
| Framework lock-in | **Low** | Fastify is well-maintained, large community |
| Performance regression | **None** | Fastify is ~equal to raw http for this workload |

---

## 5. Recommendation

### DO NOT MIGRATE NOW

**Rationale:**

1. **The current system works.** 34 routes across 2 apps, all tested, all stable. No runtime bugs from the hand-rolled approach.

2. **The migration cost is high for low value.** 5-7 days of work to rewrite tests and route wiring, with zero user-facing improvement. The platform has bigger priorities.

3. **The hand-rolled code is already modular.** Route extraction (UTV2-127, UTV2-141) already created clean separation. Adding a new route is a one-file operation.

4. **The main benefit (validation) isn't needed yet.** The API has 3 write endpoints with simple payloads. When the API surface grows significantly (10+ write endpoints with complex schemas), re-evaluate.

5. **Risk of regression during migration.** 114+ tests would need rewriting. Any subtle behavior difference (error shapes, header casing, body parsing edge cases) could break operator surfaces or worker integration.

### When to Reconsider

Re-evaluate if any of these become true:
- API surface grows beyond 20 write endpoints
- Complex request validation is needed (nested objects, conditional fields)
- OpenAPI spec generation becomes a requirement
- Performance profiling shows request handling as a bottleneck
- A major refactor is already touching all route files

### Incremental Path (if needed later)

If migration is eventually approved:
1. Start with `apps/api` only (smaller, fewer tests)
2. Use Fastify's `serverFactory` option to wrap existing http.Server — allows gradual migration
3. Convert one route at a time with Fastify's prefix-based encapsulation
4. Keep operator-web on raw http until API migration is proven stable

---

## 6. Verdict

**UTV2-152: CLOSED — evaluate only, no migration.**

The evaluation is complete. The recommendation is to defer migration until the cost/benefit ratio improves. Document preserved for future reference.
