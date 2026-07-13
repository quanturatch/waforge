import { Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { createLogger } from '../../common/services/logger.service';
import { HookManager } from '../../core/hooks';
import type { IncomingMessage } from '../../engine/interfaces/whatsapp-engine.interface';
import type { MessageService } from '../message/message.service';
import type { SessionService } from '../session/session.service';
import { bodyMatchesKeywords, parseKeywordList } from './keyword-match';

export interface GroupCleanupConfig {
  enabled: boolean;
  /** Normalized keyword phrases */
  keywords: string[];
  /** Raw comma-separated list as configured */
  keywordsRaw: string;
  /** Empty = all sessions */
  sessionIds: string[];
  forEveryone: boolean;
  /** Delay before delete so the message is fetchable in the engine store */
  delayMs: number;
  /** When true, log matches but do not delete */
  dryRun: boolean;
  /** Only act when the linked account is a group admin/super-admin */
  requireAdmin: boolean;
}

interface AdminCacheEntry {
  isAdmin: boolean;
  expiresAt: number;
}

/**
 * Auto-delete group messages that match configured keywords (e.g. "happy birthday")
 * when the WaForge session is an admin of that group.
 *
 * WhatsApp only allows deleting *other people's* group messages for everyone if you are
 * an admin. Own messages can always be deleted for everyone within WhatsApp's window.
 */
@Injectable()
export class GroupCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger(GroupCleanupService.name);
  private hookId: string | null = null;
  private messageService: MessageService | null = null;
  private sessionService: SessionService | null = null;
  /** sessionId:groupId → admin status, TTL 5 min */
  private readonly adminCache = new Map<string, AdminCacheEntry>();
  private readonly adminCacheTtlMs = 5 * 60 * 1000;
  /** Dedupe rapid double-fires of the same message */
  private readonly recentDeletes = new Map<string, number>();

  constructor(
    private readonly hookManager: HookManager,
    private readonly configService: ConfigService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  onModuleInit(): void {
    this.hookId = this.hookManager.register(
      'waforge-group-cleanup',
      'message:received',
      async ctx => {
        const msg = ctx.data as IncomingMessage;
        void this.handleInbound(ctx.sessionId, msg);
        return { continue: true };
      },
      // Run before AI auto-reply (priority 50) so we clean first.
      40,
    );
    this.logger.log('Group keyword cleanup hook registered');
  }

  onModuleDestroy(): void {
    if (this.hookId) {
      this.hookManager.unregister(this.hookId);
      this.hookId = null;
    }
  }

  getConfig(): GroupCleanupConfig {
    const raw =
      process.env.GROUP_CLEANUP_KEYWORDS ||
      this.configService.get<string>('moderation.groupCleanupKeywords') ||
      '';
    const sessionsRaw =
      process.env.GROUP_CLEANUP_SESSIONS ||
      this.configService.get<string>('moderation.groupCleanupSessions') ||
      '';
    const delayParsed = Number(
      process.env.GROUP_CLEANUP_DELAY_MS || this.configService.get<number>('moderation.groupCleanupDelayMs'),
    );

    return {
      enabled:
        process.env.GROUP_CLEANUP_ENABLED === 'true' ||
        this.configService.get<boolean>('moderation.groupCleanupEnabled') === true,
      keywords: parseKeywordList(raw),
      keywordsRaw: raw,
      sessionIds: sessionsRaw
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
      forEveryone:
        (process.env.GROUP_CLEANUP_FOR_EVERYONE ??
          String(this.configService.get('moderation.groupCleanupForEveryone') ?? 'true')) !== 'false',
      delayMs: Number.isFinite(delayParsed) && delayParsed >= 0 ? Math.min(delayParsed, 15000) : 800,
      dryRun:
        process.env.GROUP_CLEANUP_DRY_RUN === 'true' ||
        this.configService.get<boolean>('moderation.groupCleanupDryRun') === true,
      requireAdmin:
        (process.env.GROUP_CLEANUP_REQUIRE_ADMIN ??
          String(this.configService.get('moderation.groupCleanupRequireAdmin') ?? 'true')) !== 'false',
    };
  }

  getPublicStatus(): {
    enabled: boolean;
    keywords: string[];
    keywordCount: number;
    sessions: string[];
    forEveryone: boolean;
    dryRun: boolean;
    requireAdmin: boolean;
    delayMs: number;
  } {
    const c = this.getConfig();
    return {
      enabled: c.enabled,
      keywords: c.keywords,
      keywordCount: c.keywords.length,
      sessions: c.sessionIds,
      forEveryone: c.forEveryone,
      dryRun: c.dryRun,
      requireAdmin: c.requireAdmin,
      delayMs: c.delayMs,
    };
  }

  /** Exposed for unit tests / dashboard "test match" without sending WhatsApp. */
  testMatch(body: string): { matched: boolean; keyword: string | null } {
    const cfg = this.getConfig();
    const keyword = bodyMatchesKeywords(body, cfg.keywords);
    return { matched: Boolean(keyword), keyword };
  }

  private async resolveMessageService(): Promise<MessageService | null> {
    if (this.messageService) return this.messageService;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { MessageService } = require('../message/message.service') as typeof import('../message/message.service');
      this.messageService = this.moduleRef?.get(MessageService, { strict: false }) ?? null;
      return this.messageService;
    } catch {
      return null;
    }
  }

  private async resolveSessionService(): Promise<SessionService | null> {
    if (this.sessionService) return this.sessionService;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { SessionService } = require('../session/session.service') as typeof import('../session/session.service');
      this.sessionService = this.moduleRef?.get(SessionService, { strict: false }) ?? null;
      return this.sessionService;
    } catch {
      return null;
    }
  }

  private async handleInbound(sessionId: string | undefined, msg: IncomingMessage): Promise<void> {
    try {
      const cfg = this.getConfig();
      if (!cfg.enabled || !sessionId) return;
      if (!cfg.keywords.length) return;
      if (!msg.isGroup) return;
      if (msg.isStatusBroadcast) return;
      if (cfg.sessionIds.length && !cfg.sessionIds.includes(sessionId)) return;

      const body = (msg.body || '').trim();
      // Caption-less media won't match; only text/caption bodies.
      if (!body) return;

      const matched = bodyMatchesKeywords(body, cfg.keywords);
      if (!matched) return;

      const dedupeKey = `${sessionId}:${msg.id}`;
      const now = Date.now();
      if ((this.recentDeletes.get(dedupeKey) ?? 0) > now - 60_000) return;
      this.recentDeletes.set(dedupeKey, now);
      // Opportunistic prune
      if (this.recentDeletes.size > 500) {
        for (const [k, t] of this.recentDeletes) {
          if (t < now - 60_000) this.recentDeletes.delete(k);
        }
      }

      if (cfg.requireAdmin) {
        const isAdmin = await this.isSessionGroupAdmin(sessionId, msg.chatId);
        if (!isAdmin) {
          this.logger.debug(
            `Group cleanup skip (not admin): session=${sessionId} group=${msg.chatId} keyword="${matched}"`,
          );
          return;
        }
      }

      if (cfg.dryRun) {
        this.logger.log(
          `Group cleanup DRY-RUN match keyword="${matched}" session=${sessionId} group=${msg.chatId} msg=${msg.id}`,
        );
        return;
      }

      if (cfg.delayMs > 0) {
        await new Promise(r => setTimeout(r, cfg.delayMs));
      }

      const messages = await this.resolveMessageService();
      if (!messages) {
        this.logger.error('MessageService unavailable — cannot delete group message');
        return;
      }

      await messages.deleteMessage(sessionId, {
        chatId: msg.chatId,
        messageId: msg.id,
        forEveryone: cfg.forEveryone,
      });

      this.logger.log(
        `Group cleanup deleted message session=${sessionId} group=${msg.chatId} msg=${msg.id} keyword="${matched}" forEveryone=${cfg.forEveryone}`,
      );
    } catch (error) {
      this.logger.error(
        `Group cleanup failed session=${sessionId} chat=${msg?.chatId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async isSessionGroupAdmin(sessionId: string, groupId: string): Promise<boolean> {
    const cacheKey = `${sessionId}:${groupId}`;
    const cached = this.adminCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.isAdmin;

    let isAdmin = false;
    try {
      const sessions = await this.resolveSessionService();
      const engine = sessions?.getEngine(sessionId);
      if (!engine) {
        this.adminCache.set(cacheKey, { isAdmin: false, expiresAt: Date.now() + 30_000 });
        return false;
      }

      const info = await engine.getGroupInfo(groupId);
      if (!info?.participants?.length) {
        this.adminCache.set(cacheKey, { isAdmin: false, expiresAt: Date.now() + 60_000 });
        return false;
      }

      // Session phone is MSISDN digits when known (set after QR connect).
      const sessionMeta = await sessions?.findOne(sessionId).catch(() => null);
      const phone = sessionMeta?.phone?.replace(/\D/g, '') || '';

      for (const p of info.participants) {
        if (!p.isAdmin && !p.isSuperAdmin) continue;
        const pid = (p.id || '').toLowerCase();
        const pnum = (p.number || p.id?.split('@')[0] || '').replace(/\D/g, '');
        // Match by phone digits when we have them
        if (phone && pnum && (pnum === phone || pnum.endsWith(phone) || phone.endsWith(pnum))) {
          isAdmin = true;
          break;
        }
        // Fallback: if only one admin and we can't match phone, still try common JID shapes
        if (phone && pid.includes(phone)) {
          isAdmin = true;
          break;
        }
      }

      // If we have no phone on the session yet, be conservative (don't delete).
      if (!phone) {
        this.logger.warn(
          `Group cleanup: session ${sessionId} has no phone on record — cannot verify group admin; skip delete`,
        );
        isAdmin = false;
      }
    } catch (err) {
      this.logger.warn(
        `Group cleanup admin check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      isAdmin = false;
    }

    this.adminCache.set(cacheKey, {
      isAdmin,
      expiresAt: Date.now() + this.adminCacheTtlMs,
    });
    return isAdmin;
  }
}
