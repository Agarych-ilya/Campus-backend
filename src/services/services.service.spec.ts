import {
  BadRequestException,
  ConflictException,
  HttpException,
} from '@nestjs/common';
import { DbService } from '../db.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { ServicesService } from './services.service';

describe('ServicesService', () => {
  let service: ServicesService;
  let query: jest.Mock;

  const valid: CreateCommunityDto = {
    title: 'Клуб любителей робототехники',
    description: 'Общаемся о робототехнике, проектах и студенческих конкурсах.',
    category: 'Клубы и интересы',
    iconKind: 'club',
    telegramUrl: 'https://t.me/robotics_club_mpei',
  };

  beforeEach(() => {
    query = jest.fn().mockImplementation((sql: string) => {
      if (sql.startsWith('CREATE TABLE')) return [];
      if (sql.startsWith('SELECT')) return [];
      if (sql.startsWith('INSERT')) return { insertId: 42 };
      throw new Error('Unexpected query');
    });
    service = new ServicesService({ query } as unknown as DbService);
  });

  it('keeps the curated public MPEI groups', () => {
    const groups = service.getTelegramGroups();
    expect(groups.map((group) => group.username)).toEqual([
      'mpeichat',
      'mpei_1kurs',
      'MPEImai',
      'mpeiuniversity',
      'mpei_profcom',
      'oss_mpei',
    ]);
  });

  it('returns approved groups with social links and no invented counts', async () => {
    const groups = await service.getGroups();
    expect(groups).toHaveLength(6);
    expect(groups[0].telegramUrl).toBe('https://t.me/mpeichat');
    expect(groups[0].memberCount).toBeNull();
    expect(groups[2].iconKind).toBe('news');
    expect(groups[2].memberCountSource).toBe('telegram_snapshot');
    expect(groups[3].vkUrl).toBe('https://vk.com/mpei_ru');
  });

  it('returns moderator-approved SQL rows alongside the curated catalog', async () => {
    query.mockImplementation((sql: string) => {
      if (sql.startsWith('CREATE TABLE')) return [];
      return [{
        id: 10,
        title: 'Студенческий клуб',
        description: 'Новости клуба',
        category: 'Клубы и интересы',
        icon_kind: 'club',
        member_count: 450,
        telegram_url: null,
        vk_url: 'https://vk.com/example_club',
      }];
    });

    const groups = await service.getGroups();
    expect(groups).toHaveLength(7);
    expect(groups[6].vkUrl).toBe('https://vk.com/example_club');
    expect(groups[6].memberCountSource).toBe('self_reported');
  });

  it('saves a valid suggestion as pending, never approved', async () => {
    const receipt = await service.submitCommunity(valid, '192.0.2.1');
    expect(receipt.status).toBe('pending');
    const insert = query.mock.calls.find(([sql]) => sql.startsWith('INSERT'));
    expect(insert[0]).toContain("'pending'");
    expect(insert[1][5]).toBe(valid.telegramUrl);
  });

  it('rejects a suggestion with no social links', async () => {
    await expect(
      service.submitCommunity({
        ...valid,
        telegramUrl: '',
      }, '192.0.2.2'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects links to unapproved domains', async () => {
    await expect(
      service.submitCommunity({
        ...valid,
        telegramUrl: 'https://evil.example/robotics_club_mpei',
      }, '192.0.2.3'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not let a user re-submit a featured community', async () => {
    await expect(
      service.submitCommunity({
        ...valid,
        telegramUrl: 'https://t.me/mpeichat',
      }, '192.0.2.4'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('limits repeated submissions from one IP', async () => {
    await service.submitCommunity(valid, '192.0.2.5');
    await expect(
      service.submitCommunity({
        ...valid,
        telegramUrl: 'https://t.me/another_mpei_club',
      }, '192.0.2.5'),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
