import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import {
  validateSmartFormSubmission,
  getBlockingErrors,
  isValidMarketType,
  type ParsedSmartFormBody,
  type MarketType,
} from './validation.js';
import { mapSmartFormToSubmissionPayload } from './payload-mapping.js';
import { renderSmartFormPage, renderSmartFormSuccessPage } from './form-templates.js';

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
    return writeHtml(response, 200, renderSmartFormPage());
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

    const rawForm = await readFormBody(request);
    const formBody = parseSmartFormBody(rawForm);
    const marketType: MarketType | undefined = isValidMarketType(formBody.marketType)
      ? formBody.marketType
      : undefined;

    const validationErrors = validateSmartFormSubmission(formBody, marketType);
    const blockingErrors = getBlockingErrors(validationErrors);

    if (blockingErrors.length > 0) {
      if (prefersHtml(request)) {
        return writeHtml(
          response,
          422,
          renderSmartFormPage({ values: formBody, errors: validationErrors }),
        );
      }
      return writeJson(response, 422, {
        ok: false,
        error: {
          code: 'FORM_VALIDATION_FAILED',
          message: 'Please correct the highlighted fields and resubmit.',
          details: blockingErrors.map((e) => `${e.field}: ${e.message}`),
        },
      });
    }

    // All blocking validations pass — build payload and submit
    const submission = mapSmartFormToSubmissionPayload(formBody, marketType!);

    const apiResponse = await dependencies.fetchImpl(
      `${dependencies.apiBaseUrl}/api/submissions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(submission),
      },
    );

    const payload = (await apiResponse.json()) as {
      ok: boolean;
      data?: Record<string, unknown>;
      error?: { code?: string; message?: string };
    };

    if (apiResponse.ok && payload.ok && payload.data) {
      if (prefersHtml(request)) {
        return writeHtml(
          response,
          apiResponse.status,
          renderSmartFormSuccessPage({
            values: formBody,
            submissionId: readDisplayValue(payload.data.submissionId),
            pickId: readDisplayValue(payload.data.pickId),
            lifecycleState: readDisplayValue(payload.data.lifecycleState),
          }),
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
      rawForm,
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

// --- Helpers ---

function parseSmartFormBody(raw: Record<string, string>): ParsedSmartFormBody {
  // Handle sport "Other" select option
  const sport = raw['sport'] === 'Other' && raw['sportOther'] ? raw['sportOther'] : raw['sport'];
  const statType = raw['statType'] === 'Other' && raw['statTypeOther'] ? raw['statTypeOther'] : raw['statType'];
  const matchup = raw['matchup'] ?? raw['eventName'];

  const result: ParsedSmartFormBody = {};
  if (raw['capper']) result.capper = raw['capper'];
  if (raw['date']) result.date = raw['date'];
  if (sport) result.sport = sport;
  if (raw['sportsbook']) result.sportsbook = raw['sportsbook'];
  if (raw['units']) result.units = raw['units'];
  if (raw['oddsFormat']) result.oddsFormat = raw['oddsFormat'];
  if (raw['odds']) result.odds = raw['odds'];
  if (raw['confidence']) result.confidence = raw['confidence'];
  if (raw['marketType']) result.marketType = raw['marketType'];
  if (raw['player']) result.player = raw['player'];
  if (matchup) result.matchup = matchup;
  if (statType) result.statType = statType;
  if (raw['overUnder']) result.overUnder = raw['overUnder'];
  if (raw['line']) result.line = raw['line'];
  if (raw['team']) result.team = raw['team'];

  return result;
}

async function readFormBody(request: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  const params = new URLSearchParams(raw);
  return Object.fromEntries(params.entries());
}

function readDisplayValue(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : 'Unavailable';
}

function prefersHtml(request: IncomingMessage): boolean {
  const accept = request.headers.accept ?? '';
  return accept.length === 0 || accept.includes('text/html') || accept.includes('*/*');
}

function respondFormError(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  error: { code: string; message: string; details?: string[] },
  values: Record<string, string>,
) {
  if (prefersHtml(request)) {
    return writeHtml(
      response,
      status,
      renderSmartFormPage({
        values: parseSmartFormBody(values),
        errors: error.details
          ? error.details.map((d) => ({
              field: d.split(':', 1)[0]?.trim() ?? '',
              message: d,
              severity: 'error' as const,
            }))
          : [{ field: '', message: error.message, severity: 'error' as const }],
      }),
    );
  }
  return writeJson(response, status, { ok: false, error });
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
