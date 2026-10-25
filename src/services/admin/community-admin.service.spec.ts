import { ConflictException, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db.service';
import { ServicesService } from '../services.service';
import { CommunityAdminService } from './community-admin.service';

describe('CommunityAdminService', () => {
  let service: CommunityAdminService;
  let query: jest.Mock;
  let ensureTable: jest.Mock;

  beforeEach(() => {
    query = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('campus_featured_overrides') &&
          sql.startsWith('SELECT')) return [];
      if (sql.startsWith('SELECT id FROM campus_featured_icons')) return [];
      if (sql.includes('FROM campus_communities') &&
          sql.startsWith('SELECT')) {
        return [{
          id: 42,
          title: 'МЭИ Робототехника',
          description: 'Студенческие проекты и конкурсы МЭИ',
          category: 'Клубы и интересы',
          icon_kind: 'club',
          telegram_url: 'https://t.me/mpei_robotics',
          vk_url: null,
          status: 'pending',
          has_icon: 42,
        }];
      }
      if (sql.startsWith('UPDATE')) return { affectedRows: 1 };
      if (sql.startsWith('DELETE')) return { affectedRows: 1 };
      if (sql.startsWith('INSERT')) return { affectedRows: 1 };
      throw new Error('Unexpected query: ' + sql);
    });
    ensureTable = jest.fn().mockResolvedValue(undefined);
    service = new CommunityAdminService(
      { query } as unknown as DbService,
      {
        ensureTable,
        validateIcon: (file: Express.Multer.File) => ({
          mime: 'image/png', bytes: file.buffer,
        }),
      } as unknown as ServicesService,
    );
  });

  it('lists pending drafts with their protected preview URL', async () => {
    const groups = await service.list('pending');
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe('community-42');
    expect(groups[0].iconUrl).toBe('/services/admin/groups/icons/42');
    expect(groups[0].status).toBe('pending');
  });

  it('shows six built-in groups as editable administrator entries', async () => {
    const groups = await service.list();
    expect(groups.length).toBe(7);
    expect(groups[0].id).toBe('mpeichat');
    expect(groups[0].builtIn).toBe(true);
  });

  it('approves the pending group only once', async () => {
    expect(await service.review(42, 'approved')).toEqual({
      id: 42,
      status: 'approved',
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'pending'"),
      ['approved', 42],
    );

    query.mockImplementationOnce(() => ({ affectedRows: 0 }));
    await expect(service.review(42, 'approved'))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('deletes a user-submitted group and its icon', async () => {
    expect(await service.remove('community-42')).toEqual({
      id: 'community-42',
      deleted: true,
    });
    expect(query).toHaveBeenCalledWith(
      'DELETE FROM campus_community_icons WHERE community_id = ?',
      [42],
    );
    expect(query).toHaveBeenCalledWith(
      'DELETE FROM campus_communities WHERE id = ?',
      [42],
    );
  });

  it('hides built-in groups instead of deleting the code-defined seeds', async () => {
    const outcome = await service.remove('mpeichat');
    expect(outcome).toEqual({ id: 'mpeichat', status: 'hidden' });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO campus_featured_overrides'),
      expect.arrayContaining(['mpeichat', 1]),
    );
  });

  it('allows restoring a hidden built-in group', async () => {
    const outcome = await service.update('mpeichat', { hidden: false });
    expect(outcome).toEqual({ id: 'mpeichat', status: 'approved' });
  });

  it('lets the admin replace the photo of a built-in group', async () => {
    const icon = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
    await service.updateIcon('mpeichat', {
      buffer: icon,
    } as Express.Multer.File);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO campus_featured_icons'),
      ['mpeichat', 'image/png', icon],
    );
  });

  it('lets the admin replace an approved or pending custom icon', async () => {
    const icon = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
    await service.updateIcon('community-42', {
      buffer: icon,
    } as Express.Multer.File);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO campus_community_icons'),
      [42, 'image/png', icon],
    );
  });

  it('does not accept malformed community IDs', async () => {
    await expect(service.remove('community-0'))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
