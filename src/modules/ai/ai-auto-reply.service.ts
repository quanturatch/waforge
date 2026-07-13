import { Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { createLogger } from '../../common/services/logger.service';
import { HookManager } from '../../core/hooks';
import type { IncomingMessage } from '../../engine/interfaces/whatsapp-engine.interface';
import type { MessageService } from '../message/message.service';
import { getLlmProvider, isLlmProviderId } from './llm/llm.providers';
import {
  AiAutoReplyConfig,
  DEFAULT_MODELS,
  DEFAULT_SYSTEM_PROMPT,
  LlmProviderId,
} from './llm/llm.types';

/**
 * First-party AI auto-reply: listens for inbound WhatsApp messages and replies via the configured
 * LLM provider (OpenAI, Anthropic Claude, Grok/xAI, or Google Gemini). Fire-and-forget so the
 * message pipeline is never blocked on model latency.
 */
@Injectable()
export class AiAutoReplyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger(AiAutoReplyService.name);
  private hookId: string | null = null;
  private messageService: MessageService | null = null;
  /** Per chat rate limit: last reply timestamp */
  private readonly lastReplyAt = new Map<string, number>();
  private readonly minIntervalMs = 2500;

  constructor(
    private readonly hookManager: HookManager,
    private readonly configService: ConfigService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  onModuleInit(): void {
    this.hookId = this.hookManager.register(
      'waforge-ai-auto-reply',
      'message:received',
      async ctx => {
        const msg = ctx.data as IncomingMessage;
        // Never block the inbound pipeline on LLM work.
        void this.handleInbound(ctx.sessionId, msg);
        return { continue: true };
      },
      50,
    );
    this.logger.log('AI auto-reply hook registered');
  }

  onModuleDestroy(): void {
    if (this.hookId) {
      this.hookManager.unregister(this.hookId);
      this.hookId = null;
    }
  }

  getConfig(): AiAutoReplyConfig {
    const providerRaw = (process.env.AI_PROVIDER || this.configService.get<string>('ai.provider') || 'openai').toLowerCase();
    const provider: LlmProviderId = isLlmProviderId(providerRaw) ? providerRaw : 'openai';
    const modeRaw = (process.env.AI_MODE || this.configService.get<string>('ai.mode') || 'auto').toLowerCase();
    const mode = modeRaw === 'draft' ? 'draft' : 'auto';

    return {
      enabled:
        process.env.AI_AUTO_REPLY_ENABLED === 'true' ||
        this.configService.get<boolean>('ai.autoReplyEnabled') === true,
      provider,
      apiKey: process.env.AI_API_KEY || this.configService.get<string>('ai.apiKey') || '',
      model:
        process.env.AI_MODEL ||
        this.configService.get<string>('ai.model') ||
        DEFAULT_MODELS[provider],
      baseUrl: process.env.AI_BASE_URL || this.configService.get<string>('ai.baseUrl') || undefined,
      systemPrompt:
        process.env.AI_SYSTEM_PROMPT ||
        this.configService.get<string>('ai.systemPrompt') ||
        DEFAULT_SYSTEM_PROMPT,
      mode,
      replyToGroups:
        process.env.AI_REPLY_TO_GROUPS === 'true' ||
        this.configService.get<boolean>('ai.replyToGroups') === true,
      maxTokens: Number(process.env.AI_MAX_TOKENS) || this.configService.get<number>('ai.maxTokens') || 512,
      temperature:
        Number(process.env.AI_TEMPERATURE) || this.configService.get<number>('ai.temperature') || 0.7,
      ignorePrefixes: (process.env.AI_IGNORE_PREFIXES || '/,!')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
    };
  }

  getPublicStatus(): {
    enabled: boolean;
    provider: LlmProviderId;
    model: string;
    mode: 'auto' | 'draft';
    replyToGroups: boolean;
    apiKeySet: boolean;
    systemPromptPreview: string;
  } {
    const c = this.getConfig();
    return {
      enabled: c.enabled,
      provider: c.provider,
      model: c.model,
      mode: c.mode,
      replyToGroups: c.replyToGroups,
      apiKeySet: Boolean(c.apiKey),
      systemPromptPreview: c.systemPrompt.slice(0, 160),
    };
  }

  async testPrompt(userText: string): Promise<{ reply: string; provider: LlmProviderId; model: string }> {
    const cfg = this.getConfig();
    if (!cfg.apiKey) {
      throw new Error('AI_API_KEY is not configured');
    }
    const provider = getLlmProvider(cfg.provider);
    const reply = await provider.generate({
      apiKey: cfg.apiKey,
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      maxTokens: cfg.maxTokens,
      temperature: cfg.temperature,
      messages: [
        { role: 'system', content: cfg.systemPrompt },
        { role: 'user', content: userText },
      ],
    });
    return { reply, provider: cfg.provider, model: cfg.model };
  }

  private async resolveMessageService(): Promise<MessageService | null> {
    if (this.messageService) return this.messageService;
    try {
      // Lazy resolve avoids circular DI with SessionModule → hooks → AI → MessageModule.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { MessageService } = require('../message/message.service') as typeof import('../message/message.service');
      this.messageService = this.moduleRef?.get(MessageService, { strict: false }) ?? null;
      return this.messageService;
    } catch {
      return null;
    }
  }

  private async handleInbound(sessionId: string | undefined, msg: IncomingMessage): Promise<void> {
    try {
      const cfg = this.getConfig();
      if (!cfg.enabled || !sessionId) return;
      if (!cfg.apiKey) {
        this.logger.warn('AI auto-reply enabled but AI_API_KEY is empty — skipping');
        return;
      }
      if (msg.fromMe) return;
      if (msg.isStatusBroadcast) return;
      if (msg.isGroup && !cfg.replyToGroups) return;
      // Only auto-reply to plain text for v1 (media/voice need STT later).
      if (msg.type && msg.type !== 'text') return;
      const body = (msg.body || '').trim();
      if (!body) return;
      if (cfg.ignorePrefixes.some(p => body.startsWith(p))) return;

      const rateKey = `${sessionId}:${msg.chatId}`;
      const now = Date.now();
      const last = this.lastReplyAt.get(rateKey) ?? 0;
      if (now - last < this.minIntervalMs) return;
      this.lastReplyAt.set(rateKey, now);

      const provider = getLlmProvider(cfg.provider);
      const reply = await provider.generate({
        apiKey: cfg.apiKey,
        model: cfg.model,
        baseUrl: cfg.baseUrl,
        maxTokens: cfg.maxTokens,
        temperature: cfg.temperature,
        messages: [
          { role: 'system', content: cfg.systemPrompt },
          {
            role: 'user',
            content: [
              msg.isGroup ? `[group message from ${msg.author || msg.from}]` : '',
              body,
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      });

      if (!reply?.trim()) return;

      if (cfg.mode === 'draft') {
        this.logger.log('AI draft reply (not sent)', {
          sessionId,
          chatId: msg.chatId,
          provider: cfg.provider,
          preview: reply.slice(0, 120),
        });
        return;
      }

      const messages = await this.resolveMessageService();
      if (!messages) {
        this.logger.error('MessageService unavailable — cannot send AI reply');
        return;
      }

      await messages.sendText(sessionId, {
        chatId: msg.chatId,
        text: reply.trim(),
      });
      this.logger.log('AI auto-reply sent', {
        sessionId,
        chatId: msg.chatId,
        provider: cfg.provider,
        model: cfg.model,
      });
    } catch (error) {
      this.logger.error(
        `AI auto-reply failed session=${sessionId} chat=${msg?.chatId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
