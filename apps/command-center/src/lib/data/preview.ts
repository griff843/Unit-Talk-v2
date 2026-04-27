function resolveApiBaseUrl() {
  return process.env.UNIT_TALK_API_URL?.trim() || process.env.API_BASE_URL?.trim() || 'http://localhost:4000';
}

async function proxyToApi(path: string): Promise<unknown> {
  const res = await fetch(`${resolveApiBaseUrl()}${path}`, { cache: 'no-store' });
  return res.json() as unknown;
}

export async function getRoutingPreview(pickId: string): Promise<unknown> {
  return proxyToApi(`/api/picks/${encodeURIComponent(pickId)}/routing-preview`);
}

export async function getPromotionPreview(pickId: string): Promise<unknown> {
  return proxyToApi(`/api/picks/${encodeURIComponent(pickId)}/promotion-preview`);
}
