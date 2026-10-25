import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';

export type MemberCountSource = 'telegram' | 'vk' | null;

export interface CommunityMemberStats {
  memberCount: number | null;
  memberCountSource: MemberCountSource;
  memberCountCheckedAt: string | null;
  memberCountApproximate: boolean;
}

type CachedValue = {
  value: CommunityMemberStats;
  expiresAt: number;
};

/**
 * Counts are retrieved from external platforms, never entered by users.
 * Bot access and VK API tokens are optional. Public Telegram previews
 * offer a best-effort alternative when the bot cannot inspect a channel.
 */
@Injectable()
export class CommunityStatsService {
  private readonly logger = new Logger(CommunityStatsService.name);
  private readonly cache = new Map<string, CachedValue>();
  private readonly inFlight = new Map<string, Promise<CommunityMemberStats>>();

  private static readonly successTtlMs = 15 * 60 * 1000;
  private static readonly unavailableTtlMs = 2 * 60 * 1000;

  async getMemberCount(
    telegramUrl: string | null,
    vkUrl: string | null,
  ): Promise<CommunityMemberStats> {
    const key = (telegramUrl ?? '') + '|' + (vkUrl ?? '');
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const task = this.fetchCount(telegramUrl, vkUrl)
      .then((value) => {
        this.cache.set(key, {
          value,
          expiresAt: Date.now() + (
            value.memberCount === null
              ? CommunityStatsService.unavailableTtlMs
              : CommunityStatsService.successTtlMs
          ),
        });
        // Prevent unbounded memory growth for many user-submitted communities.
        if (this.cache.size > 500) {
          const first = this.cache.keys().next().value;
          if (first !== undefined) this.cache.delete(first);
        }
        return value;
      })
      .finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, task);
    return task;
  }

  private async fetchCount(
    telegramUrl: string | null,
    vkUrl: string | null,
  ): Promise<CommunityMemberStats> {
    try {
      const telegramUsername = this.telegramUsername(telegramUrl);

      if (telegramUsername) {
        const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
        const attempts: Array<Promise<{ count: number; approximate: boolean } | null>> = [
          this.publicTelegramCount(telegramUsername),
        ];
        if (token && /^[0-9]+:[a-zA-Z0-9_-]+$/.test(token)) {
          attempts.unshift(this.botTelegramCount(telegramUsername, token));
        }

        const results = await Promise.all(attempts);
        const found = results.find((item) => item !== null);
        if (found) {
          return {
            memberCount: found.count,
            memberCountSource: 'telegram',
            memberCountCheckedAt: new Date().toISOString(),
            memberCountApproximate: found.approximate,
          };
        }
      }

      const vkSlug = this.vkScreenName(vkUrl);
      const vkToken = process.env.VK_ACCESS_TOKEN?.trim();
      if (vkSlug && vkToken) {
        const count = await this.vkCount(vkSlug, vkToken);
        if (count !== null) {
          return {
            memberCount: count,
            memberCountSource: 'vk',
            memberCountCheckedAt: new Date().toISOString(),
            memberCountApproximate: false,
          };
        }
      }
    } catch (error) {
      // Never make the whole community catalog fail because of a provider outage.
      this.logger.debug('Member statistics not available: ' + String(error));
    }

    return {
      memberCount: null,
      memberCountSource: null,
      memberCountCheckedAt: null,
      memberCountApproximate: false,
    };
  }

  private telegramUsername(link: string | null): string | null {
    if (!link) return null;
    const match = /^https:\/\/t\.me\/([a-zA-Z0-9_]{5,32})\/?$/i.exec(link);
    return match?.[1] ?? null;
  }

  private vkScreenName(link: string | null): string | null {
    if (!link) return null;
    const match = /^https:\/\/vk\.com\/([a-zA-Z0-9_.-]{1,80})\/?$/i.exec(link);
    return match?.[1] ?? null;
  }

  private async botTelegramCount(
    username: string,
    token: string,
  ): Promise<{ count: number; approximate: boolean } | null> {
    try {
      const { data } = await axios.get<{
        ok: boolean;
        result?: number;
      }>('https://api.telegram.org/bot' + token + '/getChatMemberCount', {
        params: { chat_id: '@' + username },
        timeout: 4500,
        maxRedirects: 0,
      });

      if (
        data.ok &&
        typeof data.result === 'number' &&
        Number.isSafeInteger(data.result) &&
        data.result >= 0
      ) {
        return { count: data.result, approximate: false };
      }
    } catch {
      // Some groups require the bot to be a member/administrator.
    }

    return null;
  }

  private async publicTelegramCount(
    username: string,
  ): Promise<{ count: number; approximate: boolean } | null> {
    try {
      const { data: html } = await axios.get<string>(
        'https://t.me/' + username,
        {
          timeout: 4500,
          maxRedirects: 0,
          responseType: 'text',
          headers: {
            'user-agent': 'Mozilla/5.0 (compatible; CampusApp/1.0)',
            accept: 'text/html',
          },
        },
      );
      const $ = cheerio.load(html);
      const text = $('.tgme_page_extra').first().text().trim();
      return this.parseTelegramPreviewCount(text);
    } catch {
      return null;
    }
  }

  /** Telegram public page label examples: "12 091 subscribers", "12.1K members". */
  parseTelegramPreviewCount(
    label: string,
  ): { count: number; approximate: boolean } | null {
    const normalized = label.replace(/[\u00a0\u202f]/g, ' ').trim();
    const match = normalized.match(
      /^([\d\s.,]+)\s*([kKmM]?)\s+(?:subscribers?|members?|подписчик(?:ов|а)?|участник(?:ов|а)?)$/i,
    );
    if (!match) return null;

    const suffix = match[2].toUpperCase();
    if (suffix === 'K' || suffix === 'M') {
      const number = Number(match[1].replace(',', '.').replace(/\s/g, ''));
      const count = Math.round(number * (suffix === 'K' ? 1000 : 1000000));
      return Number.isSafeInteger(count) && count >= 0
        ? { count, approximate: true }
        : null;
    }

    const digits = match[1].replace(/[ ,.\u00a0\u202f]/g, '');
    if (!/^\d+$/.test(digits)) return null;
    const count = Number(digits);
    return Number.isSafeInteger(count) && count >= 0
      ? { count, approximate: false }
      : null;
  }

  private async vkCount(
    screenName: string,
    token: string,
  ): Promise<number | null> {
    try {
      const { data } = await axios.get<{
        response?: Array<{ members_count?: number }> | {
          groups?: Array<{ members_count?: number }>;
        };
        error?: { error_code?: number };
      }>('https://api.vk.com/method/groups.getById', {
        params: {
          group_id: screenName,
          fields: 'members_count',
          access_token: token,
          v: '5.199',
        },
        timeout: 4500,
        maxRedirects: 0,
      });

      const response = data.response;
      const group = Array.isArray(response)
        ? response[0]
        : response?.groups?.[0];
      const count = group?.members_count;

      return typeof count === 'number' &&
        Number.isSafeInteger(count) &&
        count >= 0
        ? count
        : null;
    } catch {
      return null;
    }
  }
}
