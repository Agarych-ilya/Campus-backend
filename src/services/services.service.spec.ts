import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { DbService } from '../db.service';
import { CommunityStatsService } from './community-stats.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { ServicesService } from './services.service';

describe('ServicesService', () => {
  let service: ServicesService;
  let query: jest.Mock;
  let getMemberCount: jest.Mock;

  const valid: CreateCommunityDto = {
    title: 'Клуб любителей робототехники',
    description: 'Общаемся о робототехнике, проектах и студенческих конкурсах.',
    category: 'Клубы и интересы',
    iconKind: 'club',
    telegramUrl: 'https://t.me/robotics_club_mpei',
  };

  const unavailable = {
    memberCount: null,
    memberCountSource: null,
    memberCountCheckedAt: null,
    memberCountApproximate: false,
  };

  beforeEach(() => {
    query = jest.fn().mockImplementation((sql: string) => {
      if (sql.startsWith('CREATE TABLE')) return [];
      if (sql.startsWith('SELECT')) return [];
      if (sql.startsWith('INSERT')) return { insertId: 42 };
      throw new Error('Unexpected query');
    });
    getMemberCount = jest.fn().mockResolvedValue(unavailable);
    service = new ServicesService(
      { query } as unknown as DbService,
      { getMemberCount } as unknown as CommunityStatsService,
    );
  });

  it('keeps the six curated public MPEI groups', () => {
    expect(service.getTelegramGroups().map((group) => group.username)).toEqual([
      'mpeichat',
      'mpei_1kurs',
      'MPEImai',
      'mpeiuniversity',
      'mpei_profcom',
      'oss_mpei',
    ]);
  });

  it('never presents a manually entered or historical count', async () => {
    const groups = await service.getGroups();
    expect(groups).toHaveLength(6);
    expect(groups[0].memberCount).toBeNull();
    expect(groups[2].memberCount).toBeNull();
    expect(groups[3].vkUrl).toBe('https://vk.com/mpei_ru');
    expect(getMemberCount).toHaveBeenCalledTimes(6);
  });

  it('uses social network statistics when the provider returns them', async () => {
    getMemberCount.mockResolvedValueOnce({
      memberCount: 1234,
      memberCountSource: 'telegram',
      memberCountCheckedAt: '2026-10-25T12:00:00.000Z',
      memberCountApproximate: false,
    });

    const groups = await service.getGroups();
    expect(groups[0].memberCount).toBe(1234);
    expect(groups[0].memberCountSource).toBe('telegram');
    expect(groups[0].memberCountCheckedAt).toContain('2026-10-25');
  });

  it('returns approved groups and an image URL, but not the blob', async () => {
    query.mockImplementation((sql: string) => {
      if (sql.startsWith('CREATE TABLE')) return [];
      return [{
        id: 10,
        title: 'Студенческий клуб',
        description: 'Новости клуба',
        category: 'Клубы и интересы',
        icon_kind: 'club',
        icon_uploaded: 10,
        telegram_url: null,
        vk_url: 'https://vk.com/example_club',
      }];
    });

    const groups = await service.getGroups();
    expect(groups).toHaveLength(7);
    expect(groups[6].vkUrl).toBe('https://vk.com/example_club');
    expect(groups[6].iconUrl).toBe('/services/groups/icons/10');
    expect(groups[6].memberCount).toBeNull();
  });

  it('saves valid suggestions as pending and ignores legacy manual counts', async () => {
    const receipt = await service.submitCommunity({
      ...valid,
      memberCount: 999999,
    }, '192.0.2.1');
    expect(receipt.status).toBe('pending');
    const insert = query.mock.calls.find(([sql]) =>
      sql.startsWith('INSERT INTO campus_communities'),
    );
    expect(insert[0]).toContain("'pending'");
    expect(insert[1][4]).toBeNull();
    expect(insert[1][5]).toBe(valid.telegramUrl);
  });

  it('stores chosen PNG icon bytes with the pending record', async () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
    await service.submitCommunity(valid, '192.0.2.2', {
      buffer: png,
    } as Express.Multer.File);

    const upload = query.mock.calls.find(([sql]) =>
      sql.startsWith('INSERT INTO campus_community_icons'),
    );
    expect(upload[1][0]).toBe(42);
    expect(upload[1][1]).toBe('image/png');
    expect(Buffer.compare(upload[1][2], png)).toBe(0);
  });

  it('rejects unsupported image types', async () => {
    await expect(service.submitCommunity(valid, '192.0.2.3', {
      buffer: Buffer.from('not-an-image-file'),
    } as Express.Multer.File)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not return unpublished icons', async () => {
    await expect(
      service.getPublicIcon(42),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a suggestion without social links', async () => {
    await expect(service.submitCommunity({
      ...valid,
      telegramUrl: '',
    }, '192.0.2.4')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects links to unapproved domains', async () => {
    await expect(service.submitCommunity({
      ...valid,
      telegramUrl: 'https://evil.example/robotics_club_mpei',
    }, '192.0.2.5')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not let a user re-submit a featured community', async () => {
    await expect(service.submitCommunity({
      ...valid,
      telegramUrl: 'https://t.me/mpeichat',
    }, '192.0.2.6')).rejects.toBeInstanceOf(ConflictException);
  });

  it('limits repeated submissions from one IP', async () => {
    await service.submitCommunity(valid, '192.0.2.7');
    await expect(service.submitCommunity({
      ...valid,
      telegramUrl: 'https://t.me/another_mpei_club',
    }, '192.0.2.7')).rejects.toBeInstanceOf(HttpException);
  });
});
