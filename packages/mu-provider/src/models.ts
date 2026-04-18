import type { ApiModel } from './types';

export async function listModels(baseUrl: string): Promise<ApiModel[]> {
  try {
    const res = await fetch(`${baseUrl}/models`);
    const data = await res.json();
    return (data.data ?? []).map((m: { id: string }) => ({ id: m.id }));
  } catch {
    return [];
  }
}
