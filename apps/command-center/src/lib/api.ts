const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:3000';

export async function fetchSnapshot(): Promise<unknown> {
  const res = await fetch(`${API_BASE}/api/operator/snapshot`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Snapshot fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchPicksPipeline(): Promise<unknown> {
  const res = await fetch(`${API_BASE}/api/operator/picks-pipeline`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Pipeline fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchRecap(): Promise<unknown> {
  const res = await fetch(`${API_BASE}/api/operator/recap`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Recap fetch failed: ${res.status}`);
  return res.json();
}
