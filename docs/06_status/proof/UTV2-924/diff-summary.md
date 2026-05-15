# Diff Summary — UTV2-924: OpenTelemetry Foundation

## Issue
Services had no structured way to propagate W3C traceparent headers or initialize OpenTelemetry tracing. The observability package provided correlation IDs but not trace context.

## Changes

### `packages/observability/src/index.ts` (+148 lines)

**Trace header reading:**
- `readTraceparent(headers)` — reads `traceparent` header from HTTP headers
- `normalizeTraceparent(value)` — normalizes and caps to 256 chars

**Trace context propagation:**
- `createTraceContext({ correlationId, traceparent? })` — creates trace context object
- `attachTraceContextToMetadata(metadata, { correlationId, traceparent? })` — merges trace context into submission metadata
- `readCorrelationIdFromMetadata(metadata)` — extracts correlationId from opaque metadata
- `readTraceparentFromMetadata(metadata)` — extracts traceparent from opaque metadata
- `readTraceContextFromOutboxPayload(payload)` — extracts trace context from outbox row payload

**Structured logging:**
- `createTraceLogFields({ correlationId?, traceparent?, spanName?, lifecyclePoint? })` — creates log fields object from trace context (satisfies `LogFields`)

**OTel SDK initialization:**
- `initializeOpenTelemetry({ serviceName, otlpEndpoint?, logger? })` — lazy SDK init via dynamic import. No-op (returns `enabled: false`) when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset or `@opentelemetry/sdk-node` is not installed. Wraps errors gracefully.

## Design Notes
- `initializeOpenTelemetry` uses `new Function('specifier', 'return import(specifier)')` to avoid bundling OTel at compile time — OTel tracing is opt-in via env var
- All new functions are fail-safe: missing/malformed headers return `undefined`, missing packages degrade to disabled
- No new dependencies added to package.json (OTel is optional at runtime)

## Result
- 178/178 tests pass (full suite)
- 32/32 observability package tests pass
- `pnpm type-check` green

## Merge
Squash-merged to main as SHA `3fff22dc1768bede0879220e75bf2cfe946c0199` (PR #675, merged 2026-05-15T11:54:26Z)
