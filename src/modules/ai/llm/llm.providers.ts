import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_BASE_URLS,
  LlmGenerateParams,
  LlmProvider,
  LlmProviderId,
} from './llm.types';

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs = 45000,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let data: unknown = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const msg =
        typeof data === 'object' && data && 'error' in data
          ? JSON.stringify((data as { error: unknown }).error)
          : text.slice(0, 400);
      throw new BadRequestException(`LLM HTTP ${res.status}: ${msg}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** OpenAI Chat Completions — also used for Grok (xAI OpenAI-compatible API). */
class OpenAiCompatibleProvider implements LlmProvider {
  constructor(
    readonly id: LlmProviderId,
    private readonly defaultBase: string,
  ) {}

  async generate(params: LlmGenerateParams): Promise<string> {
    const base = (params.baseUrl || this.defaultBase).replace(/\/+$/, '');
    const data = (await postJson(
      `${base}/chat/completions`,
      { Authorization: `Bearer ${params.apiKey}` },
      {
        model: params.model,
        messages: params.messages,
        max_tokens: params.maxTokens ?? 512,
        temperature: params.temperature ?? 0.7,
      },
    )) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new BadRequestException('LLM returned empty completion');
    return content;
  }
}

class AnthropicProvider implements LlmProvider {
  readonly id: LlmProviderId = 'anthropic';

  async generate(params: LlmGenerateParams): Promise<string> {
    const base = (params.baseUrl || DEFAULT_BASE_URLS.anthropic).replace(/\/+$/, '');
    const system = params.messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
    const messages = params.messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

    const data = (await postJson(
      `${base}/v1/messages`,
      {
        'x-api-key': params.apiKey,
        'anthropic-version': '2023-06-01',
      },
      {
        model: params.model,
        max_tokens: params.maxTokens ?? 512,
        temperature: params.temperature ?? 0.7,
        system: system || undefined,
        messages,
      },
    )) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = data.content?.find(c => c.type === 'text')?.text?.trim();
    if (!text) throw new BadRequestException('Anthropic returned empty content');
    return text;
  }
}

class GeminiProvider implements LlmProvider {
  readonly id: LlmProviderId = 'gemini';

  async generate(params: LlmGenerateParams): Promise<string> {
    const base = (params.baseUrl || DEFAULT_BASE_URLS.gemini).replace(/\/+$/, '');
    const system = params.messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
    const contents = params.messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const url = `${base}/models/${encodeURIComponent(params.model)}:generateContent?key=${encodeURIComponent(params.apiKey)}`;
    const data = (await postJson(url, {}, {
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents,
      generationConfig: {
        maxOutputTokens: params.maxTokens ?? 512,
        temperature: params.temperature ?? 0.7,
      },
    })) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
    if (!text) throw new BadRequestException('Gemini returned empty content');
    return text;
  }
}

const providers: Record<LlmProviderId, LlmProvider> = {
  openai: new OpenAiCompatibleProvider('openai', DEFAULT_BASE_URLS.openai),
  grok: new OpenAiCompatibleProvider('grok', DEFAULT_BASE_URLS.grok),
  anthropic: new AnthropicProvider(),
  gemini: new GeminiProvider(),
};

export function getLlmProvider(id: LlmProviderId): LlmProvider {
  const p = providers[id];
  if (!p) throw new BadRequestException(`Unknown LLM provider: ${id}`);
  return p;
}

export function isLlmProviderId(value: string): value is LlmProviderId {
  return value === 'openai' || value === 'anthropic' || value === 'grok' || value === 'gemini';
}
