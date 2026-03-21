import http, { type IncomingMessage, type ServerResponse } from 'node:http';

export interface SmartFormServerOptions {
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  maxBodyBytes?: number;
}

export function createSmartFormServer(options: SmartFormServerOptions = {}) {
  const apiBaseUrl = options.apiBaseUrl ?? process.env.UNIT_TALK_API_BASE_URL ?? 'http://127.0.0.1:3000';
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxBodyBytes = options.maxBodyBytes ?? 65536;

  return http.createServer(async (request, response) => {
    await routeSmartFormRequest(request, response, { apiBaseUrl, fetchImpl, maxBodyBytes });
  });
}

export async function routeSmartFormRequest(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: {
    apiBaseUrl: string;
    fetchImpl: typeof fetch;
    maxBodyBytes: number;
  },
) {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');

  if (method === 'GET' && url.pathname === '/health') {
    return writeJson(response, 200, {
      ok: true,
      service: 'smart-form',
      apiBaseUrl: dependencies.apiBaseUrl,
    });
  }

  if (method === 'GET' && url.pathname === '/') {
    return writeHtml(response, 200, renderSmartForm());
  }

  if (method === 'POST' && url.pathname === '/submit') {
    const contentLength = Number(request.headers['content-length'] ?? '0');
    if (contentLength > dependencies.maxBodyBytes) {
      return respondFormError(
        request,
        response,
        413,
        {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Request body exceeds maximum allowed size',
        },
        {},
      );
    }
    const formBody = await readFormBody(request);
    const validationErrors = validateForm(formBody);

    if (validationErrors.length > 0) {
      return respondFormError(
        request,
        response,
        422,
        {
          code: 'FORM_VALIDATION_FAILED',
          message: 'Please correct the highlighted fields and resubmit.',
          details: validationErrors,
        },
        formBody,
      );
    }

    const submission = mapFormToSubmission(formBody);

    const apiResponse = await dependencies.fetchImpl(
      `${dependencies.apiBaseUrl}/api/submissions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(submission),
      },
    );

    const payload = (await apiResponse.json()) as {
      ok: boolean;
      data?: Record<string, unknown>;
      error?: {
        code?: string;
        message?: string;
      };
    };

    if (apiResponse.ok && payload.ok && payload.data) {
      if (prefersHtml(request)) {
        return writeHtml(
          response,
          apiResponse.status,
          renderSmartFormSuccess(formBody, payload.data),
        );
      }

      return writeJson(response, apiResponse.status, payload);
    }

    return respondFormError(
      request,
      response,
      apiResponse.status,
      {
        code: payload.error?.code ?? 'SUBMISSION_FAILED',
        message: payload.error?.message ?? 'Submission failed',
      },
      formBody,
    );
  }

  return writeJson(response, 404, {
    ok: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route not found: ${method} ${url.pathname}`,
    },
  });
}

function renderSmartForm() {
  return renderSmartFormPage();
}

function renderSmartFormPage(options: {
  values?: Record<string, string>;
  error?: {
    code: string;
    message: string;
    details?: string[];
  };
} = {}) {
  const values = options.values ?? {};
  const errors = new Set(extractErrorFields(options.error?.details ?? []));

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Unit Talk V2 Smart Form</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f3ede3;
        --panel: #fffdf8;
        --ink: #1f2933;
        --muted: #6b7280;
        --line: #d7d0c3;
        --accent: #0f4c81;
      }
      body {
        margin: 0;
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        background: linear-gradient(180deg, #fff8ea 0%, var(--bg) 48%, #ece3d7 100%);
        color: var(--ink);
      }
      main {
        max-width: 780px;
        margin: 0 auto;
        padding: 36px 20px 48px;
      }
      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 20px;
        padding: 24px;
        box-shadow: 0 12px 32px rgba(31, 41, 51, 0.08);
      }
      h1 {
        margin-top: 0;
      }
      p {
        color: var(--muted);
      }
      .notice {
        border-radius: 14px;
        padding: 14px 16px;
        margin-bottom: 18px;
      }
      .notice.error {
        background: #fff1f2;
        border: 1px solid #fecdd3;
        color: #9f1239;
      }
      .notice.success {
        background: #ecfdf3;
        border: 1px solid #bbf7d0;
        color: #166534;
      }
      .error-list {
        margin: 8px 0 0;
        padding-left: 20px;
      }
      form {
        display: grid;
        gap: 14px;
      }
      label {
        display: grid;
        gap: 6px;
        font-weight: 600;
      }
      input, textarea, button {
        font: inherit;
      }
      input, textarea {
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 12px 14px;
        background: #fff;
      }
      .field-error input,
      .field-error textarea {
        border-color: #be123c;
        background: #fff7f8;
      }
      .hint {
        font-size: 0.92rem;
        color: var(--muted);
      }
      .field-error .hint {
        color: #9f1239;
      }
      textarea {
        min-height: 96px;
        resize: vertical;
      }
      button {
        background: var(--accent);
        color: #fff;
        border: none;
        border-radius: 999px;
        padding: 12px 18px;
        font-weight: 700;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="panel">
        <h1>Unit Talk V2 Smart Form</h1>
        <p>Intake submits through the backend-owned submission path. This surface never writes canonical picks directly.</p>
        ${
          options.error
            ? `<div class="notice error">
          <strong>${escapeHtml(options.error.message)}</strong>
          ${
            options.error.details && options.error.details.length > 0
              ? `<ul class="error-list">${options.error.details
                  .map((detail) => `<li>${escapeHtml(detail)}</li>`)
                  .join('')}</ul>`
              : ''
          }
        </div>`
            : ''
        }
        <form method="post" action="/submit">
          <label>Source
            <input name="source" value="smart-form" readonly />
            <span class="hint">Locked by the server. Smart Form is always the submission source.</span>
          </label>
          <label class="${errors.has('submittedBy') ? 'field-error' : ''}">Submitted By
            <input name="submittedBy" placeholder="griff843" value="${escapeHtml(values.submittedBy ?? '')}" />
          </label>
          <label class="${errors.has('market') ? 'field-error' : ''}">Market
            <input name="market" placeholder="NBA points" required value="${escapeHtml(values.market ?? '')}" />
            <span class="hint">Example: NBA points, NHL shots on goal, MLB total bases.</span>
          </label>
          <label class="${errors.has('selection') ? 'field-error' : ''}">Selection
            <input name="selection" placeholder="Over 24.5" required value="${escapeHtml(values.selection ?? '')}" />
            <span class="hint">Enter the exact side or prop to be posted.</span>
          </label>
          <label class="${errors.has('line') ? 'field-error' : ''}">Line
            <input name="line" type="number" step="0.1" placeholder="24.5" value="${escapeHtml(values.line ?? '')}" />
          </label>
          <label class="${errors.has('odds') ? 'field-error' : ''}">Odds
            <input name="odds" type="number" step="1" placeholder="-110" value="${escapeHtml(values.odds ?? '')}" />
          </label>
          <label class="${errors.has('stakeUnits') ? 'field-error' : ''}">Stake Units
            <input name="stakeUnits" type="number" step="0.1" placeholder="1" value="${escapeHtml(values.stakeUnits ?? '')}" />
          </label>
          <label class="${errors.has('confidence') ? 'field-error' : ''}">Confidence
            <input name="confidence" type="number" step="0.01" placeholder="0.72" value="${escapeHtml(values.confidence ?? '')}" />
          </label>
          <label class="${errors.has('eventName') ? 'field-error' : ''}">Event Name
            <input name="eventName" placeholder="Knicks vs Heat" value="${escapeHtml(values.eventName ?? '')}" />
          </label>
          <label class="${errors.has('metadata') ? 'field-error' : ''}">Metadata (JSON)
            <textarea name="metadata" placeholder='{"sport":"NBA","capper":"griff843"}'>${escapeHtml(values.metadata ?? '')}</textarea>
            <span class="hint">Optional JSON object for routing and display context.</span>
          </label>
          <button type="submit">Submit Pick</button>
        </form>
      </section>
    </main>
  </body>
</html>`;
}

function renderSmartFormSuccess(values: Record<string, string>, data: Record<string, unknown>) {
  return renderSmartFormPageWithSuccess({
    values,
    submissionId: readDisplayValue(data.submissionId),
    pickId: readDisplayValue(data.pickId),
    lifecycleState: readDisplayValue(data.lifecycleState),
  });
}

function renderSmartFormPageWithSuccess(options: {
  values: Record<string, string>;
  submissionId: string;
  pickId: string;
  lifecycleState: string;
}) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Submission Received | Unit Talk V2</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #edf6f1;
        --panel: #ffffff;
        --ink: #1f2933;
        --muted: #5b6570;
        --line: #c9ddd2;
        --accent: #166534;
      }
      body {
        margin: 0;
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        background: linear-gradient(180deg, #f6fff8 0%, var(--bg) 50%, #e2efe7 100%);
        color: var(--ink);
      }
      main {
        max-width: 760px;
        margin: 0 auto;
        padding: 40px 20px 56px;
      }
      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 20px;
        padding: 28px;
        box-shadow: 0 14px 36px rgba(31, 41, 51, 0.08);
      }
      .notice {
        background: #ecfdf3;
        border: 1px solid #bbf7d0;
        color: #166534;
        border-radius: 14px;
        padding: 14px 16px;
        margin-bottom: 20px;
      }
      dl {
        display: grid;
        grid-template-columns: 150px 1fr;
        gap: 10px 14px;
      }
      dt {
        font-weight: 700;
      }
      dd {
        margin: 0;
        color: var(--muted);
      }
      .actions {
        margin-top: 24px;
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }
      a {
        text-decoration: none;
        border-radius: 999px;
        padding: 12px 18px;
        font-weight: 700;
      }
      .primary {
        background: var(--accent);
        color: white;
      }
      .secondary {
        border: 1px solid var(--line);
        color: var(--ink);
        background: #fff;
      }
      code {
        font-family: Consolas, monospace;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="panel">
        <div class="notice"><strong>Submission received.</strong> Intake handed off to the backend-owned submission path successfully.</div>
        <h1>Pick queued for processing</h1>
        <p>Your submission is now in the canonical intake flow. This page confirms handoff only; downstream posting still follows the canary-only distribution policy.</p>
        <dl>
          <dt>Submission ID</dt>
          <dd><code>${escapeHtml(options.submissionId)}</code></dd>
          <dt>Pick ID</dt>
          <dd><code>${escapeHtml(options.pickId)}</code></dd>
          <dt>Lifecycle State</dt>
          <dd>${escapeHtml(options.lifecycleState)}</dd>
          <dt>Market</dt>
          <dd>${escapeHtml(options.values.market ?? '')}</dd>
          <dt>Selection</dt>
          <dd>${escapeHtml(options.values.selection ?? '')}</dd>
          <dt>Event</dt>
          <dd>${escapeHtml(options.values.eventName ?? 'Not provided')}</dd>
        </dl>
        <div class="actions">
          <a class="primary" href="/">Submit another pick</a>
        </div>
      </section>
    </main>
  </body>
</html>`;
}

async function readFormBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  const params = new URLSearchParams(raw);

  return Object.fromEntries(params.entries());
}

function mapFormToSubmission(form: Record<string, string>) {
  return {
    source: 'smart-form' as const,
    submittedBy: optionalString(form.submittedBy),
    market: form.market ?? '',
    selection: form.selection ?? '',
    line: optionalNumber(form.line),
    odds: optionalNumber(form.odds),
    stakeUnits: optionalNumber(form.stakeUnits),
    confidence: optionalNumber(form.confidence),
    eventName: optionalString(form.eventName),
    metadata: parseMetadata(form.metadata),
  };
}

function parseMetadata(value: string | undefined) {
  if (!value || value.trim().length === 0) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {
      rawMetadata: value,
    };
  }

  return undefined;
}

function validateForm(form: Record<string, string>) {
  const errors: string[] = [];

  if (!optionalString(form.market)) {
    errors.push('market: Market is required.');
  }

  if (!optionalString(form.selection)) {
    errors.push('selection: Selection is required.');
  }

  if (form.metadata && form.metadata.trim().length > 0) {
    try {
      const parsed = JSON.parse(form.metadata) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        errors.push('metadata: Metadata must be a JSON object.');
      }
    } catch {
      errors.push('metadata: Metadata must be valid JSON.');
    }
  }

  for (const field of ['line', 'odds', 'stakeUnits', 'confidence'] as const) {
    if (form[field] && form[field].trim().length > 0 && optionalNumber(form[field]) === undefined) {
      errors.push(`${field}: ${formatFieldLabel(field)} must be a valid number.`);
    }
  }

  return errors;
}

function formatFieldLabel(field: string) {
  switch (field) {
    case 'stakeUnits':
      return 'Stake units';
    default:
      return field.charAt(0).toUpperCase() + field.slice(1);
  }
}

function extractErrorFields(details: string[]) {
  return details
    .map((detail) => detail.split(':', 1)[0]?.trim())
    .filter((field): field is string => Boolean(field));
}

function readDisplayValue(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : 'Unavailable';
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function prefersHtml(request: IncomingMessage) {
  const accept = request.headers.accept ?? '';
  return accept.length === 0 || accept.includes('text/html') || accept.includes('*/*');
}

function respondFormError(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  error: {
    code: string;
    message: string;
    details?: string[];
  },
  values: Record<string, string>,
) {
  if (prefersHtml(request)) {
    return writeHtml(response, status, renderSmartFormPage({ values, error }));
  }

  return writeJson(response, status, {
    ok: false,
    error,
  });
}

function optionalString(value: string | undefined) {
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalNumber(value: string | undefined) {
  if (!value || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function writeJson(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function writeHtml(response: ServerResponse, status: number, body: string) {
  response.statusCode = status;
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.end(body);
}
