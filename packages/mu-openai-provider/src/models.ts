import type { ApiModel } from 'mu-core';
import OpenAI from 'openai';

export async function listModels(baseUrl: string): Promise<ApiModel[]> {
  try {
    // Local OpenAI-compatible servers don't enforce auth; a placeholder
    // apiKey satisfies the SDK without leaking real credentials.
    const client = new OpenAI({ baseURL: baseUrl, apiKey: 'sk-local' });
    const list = await client.models.list();
    return list.data.map((m) => ({ id: m.id }));
  } catch {
    return [];
  }
}
