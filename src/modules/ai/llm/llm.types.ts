export type LlmProviderId = 'openai' | 'anthropic' | 'grok' | 'gemini';

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmGenerateParams {
  model: string;
  messages: LlmChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Optional OpenAI-compatible base URL override (openai/grok). */
  baseUrl?: string;
  apiKey: string;
}

export interface LlmProvider {
  readonly id: LlmProviderId;
  generate(params: LlmGenerateParams): Promise<string>;
}

export interface AiAutoReplyConfig {
  enabled: boolean;
  provider: LlmProviderId;
  apiKey: string;
  model: string;
  baseUrl?: string;
  systemPrompt: string;
  /** auto = send reply; draft = log only (no send) */
  mode: 'auto' | 'draft';
  replyToGroups: boolean;
  maxTokens: number;
  temperature: number;
  /** Comma-separated substrings; if body starts with one, skip AI (e.g. "/") */
  ignorePrefixes: string[];
}

export const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful WhatsApp business assistant for WaForge. ' +
  'Reply concisely in the same language as the customer. ' +
  'Do not invent policies, prices, or commitments. If unsure, say a human will follow up.';

export const DEFAULT_MODELS: Record<LlmProviderId, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-20250514',
  grok: 'grok-4.5',
  gemini: 'gemini-2.0-flash',
};

export const DEFAULT_BASE_URLS: Record<LlmProviderId, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  grok: 'https://api.x.ai/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
};
