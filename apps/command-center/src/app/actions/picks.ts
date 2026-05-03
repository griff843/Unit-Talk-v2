'use server';

import { getPickDetail } from '@/lib/data';
import type { PickDetailViewResponse } from '@/lib/data/queues';

export async function loadPickDetail(pickId: string): Promise<PickDetailViewResponse | null> {
  return getPickDetail(pickId);
}
