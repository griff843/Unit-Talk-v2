import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRuntimeDependencies } from '../server.js';
import { handleSettlePick } from '../handlers/index.js';
import { requeuePickController } from '../controllers/requeue-controller.js';
import { reviewPickController } from '../controllers/review-pick-controller.js';
import { retryDeliveryController } from '../controllers/retry-delivery-controller.js';
import { rerunPromotionController } from '../controllers/rerun-promotion-controller.js';
import { overridePromotionController } from '../controllers/override-promotion-controller.js';
import { routingPreviewController } from '../controllers/routing-preview-controller.js';
import { promotionPreviewController } from '../controllers/promotion-preview-controller.js';
import { tracePickController } from '../controllers/trace-pick-controller.js';
import { readJsonBody } from '../server.js';
import { writeJson } from '../http-utils.js';

export async function handleSettlePickRoute(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
  pickId: string,
): Promise<void> {
  const body = await readJsonBody(request, runtime.bodyLimitBytes);
  const apiResponse = await handleSettlePick(
    {
      params: { pickId },
      body,
    },
    runtime.repositories,
  );
  writeJson(response, apiResponse.status, apiResponse.body);
}

export async function handleReviewPickRoute(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
  pickId: string,
): Promise<void> {
  const body = await readJsonBody(request, runtime.bodyLimitBytes);
  const apiResponse = await reviewPickController(pickId, body as { decision: string; reason: string; decidedBy: string }, runtime.repositories);
  writeJson(response, apiResponse.status, apiResponse.body);
}

export async function handleRetryDeliveryRoute(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
  pickId: string,
): Promise<void> {
  const body = await readJsonBody(request, runtime.bodyLimitBytes);
  const apiResponse = await retryDeliveryController(pickId, body as { reason: string; actor: string }, runtime.repositories);
  writeJson(response, apiResponse.status, apiResponse.body);
}

export async function handleRerunPromotionRoute(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
  pickId: string,
): Promise<void> {
  const body = await readJsonBody(request, runtime.bodyLimitBytes);
  const apiResponse = await rerunPromotionController(pickId, body as { reason: string; actor: string }, runtime.repositories);
  writeJson(response, apiResponse.status, apiResponse.body);
}

export async function handleOverridePromotionRoute(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
  pickId: string,
): Promise<void> {
  const body = await readJsonBody(request, runtime.bodyLimitBytes);
  const apiResponse = await overridePromotionController(pickId, body as { action: 'force_promote' | 'suppress'; target?: string; reason: string; actor: string }, runtime.repositories);
  writeJson(response, apiResponse.status, apiResponse.body);
}

export async function handleRequeuePick(
  _request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
  pickId: string,
): Promise<void> {
  const apiResponse = await requeuePickController(pickId, runtime.repositories);
  writeJson(response, apiResponse.status, apiResponse.body);
}

export async function handleTracePickRoute(
  _request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
  pickId: string,
): Promise<void> {
  const apiResponse = await tracePickController(pickId, runtime.repositories);
  writeJson(response, apiResponse.status, apiResponse.body);
}

export async function handleRoutingPreviewRoute(
  _request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
  pickId: string,
): Promise<void> {
  const apiResponse = await routingPreviewController(pickId, runtime.repositories);
  writeJson(response, apiResponse.status, apiResponse.body);
}

export async function handlePromotionPreviewRoute(
  _request: IncomingMessage,
  response: ServerResponse,
  runtime: ApiRuntimeDependencies,
  pickId: string,
): Promise<void> {
  const apiResponse = await promotionPreviewController(pickId, runtime.repositories);
  writeJson(response, apiResponse.status, apiResponse.body);
}
