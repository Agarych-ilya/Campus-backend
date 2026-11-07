import axios from 'axios';
import { CommunityStatsService } from './community-stats.service';

describe('CommunityStatsService', () => {
  let service: CommunityStatsService;
  const oldBot = process.env.TELEGRAM_BOT_TOKEN;
  const oldVk = process.env.VK_ACCESS_TOKEN;

  beforeEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.VK_ACCESS_TOKEN;
    service = new CommunityStatsService();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (oldBot === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = oldBot;
    if (oldVk === undefined) delete process.env.VK_ACCESS_TOKEN;
    else process.env.VK_ACCESS_TOKEN = oldVk;
  });

  it('parses exact Telegram public counts', () => {
    expect(service.parseTelegramPreviewCount('12 091 subscribers')).toEqual({
      count: 12091,
      approximate: false,
    });
    expect(service.parseTelegramPreviewCount('2392 members')).toEqual({
      count: 2392,
      approximate: false,
    });
  });

  it('marks abbreviated Telegram counts as approximate', () => {
    expect(service.parseTelegramPreviewCount('12.1K subscribers')).toEqual({
      count: 12100,
      approximate: true,
    });
    expect(service.parseTelegramPreviewCount('1.2M members')).toEqual({
      count: 1200000,
      approximate: true,
    });
  });

  it('never guesses counts from unsupported HTML', () => {
    expect(service.parseTelegramPreviewCount('View in Telegram')).toBeNull();
    expect(service.parseTelegramPreviewCount('join chat')).toBeNull();
  });

  it('retrieves live Telegram public-page counts and caches them', async () => {
    const get = jest.spyOn(axios, 'get').mockResolvedValue({
      data: '<html><div class="tgme_page_extra">12 091 subscribers</div></html>',
    } as never);

    const first = await service.getMemberCount(
      'https://t.me/mpeiuniversity',
      null,
    );
    const second = await service.getMemberCount(
      'https://t.me/mpeiuniversity',
      null,
    );
    expect(first.memberCount).toBe(12091);
    expect(first.memberCountSource).toBe('telegram');
    expect(second).toEqual(first);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('uses VK API for a VK-only group with a configured access token', async () => {
    process.env.VK_ACCESS_TOKEN = 'test_vk_token';
    jest.spyOn(axios, 'get').mockResolvedValue({
      data: {
        response: [{
          id: 42,
          members_count: 3200,
        }],
      },
    } as never);

    const result = await service.getMemberCount(
      null,
      'https://vk.com/my_club',
    );
    expect(result.memberCount).toBe(3200);
    expect(result.memberCountSource).toBe('vk');
  });

  it('returns unavailable when a source denies access', async () => {
    jest.spyOn(axios, 'get').mockRejectedValue(new Error('Forbidden'));

    const result = await service.getMemberCount(
      'https://t.me/locked_chat',
      null,
    );
    expect(result.memberCount).toBeNull();
    expect(result.memberCountSource).toBeNull();
  });
});
