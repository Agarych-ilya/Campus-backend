import {
  ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { DbService } from '../db.service';
import { CampusCloudService } from './campus-cloud.service';

describe('CampusCloudService security', () => {
  const owner = 'a'.repeat(64);
  const stranger = 'b'.repeat(64);
  const ownerViewer = { key: owner, group: 'А-03-23' };
  const otherViewer = { key: stranger, group: 'Б-01-25' };
  const sample = {
    id: 10, owner_key: owner, name: 'Конспект.pdf',
    path: '/missing/konsp.pdf', mime: 'application/pdf', size_bytes: 400,
    folder_id: null, visibility: 'private', group_code: null,
    share_hash: null, created_at: new Date(),
  };
  let query: jest.Mock;
  let cloud: CampusCloudService;

  beforeEach(() => {
    query = jest.fn(async (sql: string) => {
      if (sql.startsWith('SELECT * FROM campus_cloud_files')) return [sample];
      if (sql.startsWith('SELECT * FROM campus_cloud_folders')) return [];
      if (sql.startsWith('SELECT file_id')) return [];
      if (sql.startsWith('SELECT')) return [];
      return { insertId: 8, affectedRows: 1 };
    });
    cloud = new CampusCloudService({ query } as unknown as DbService);
  });

  test('folders require verified BARS identity', async () => {
    await expect(cloud.createFolder({}, {
      name: 'Лабораторные', visibility: 'private',
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  test('cannot create group folder without verified group', async () => {
    await expect(cloud.createFolder({ key: owner }, {
      name: 'ЛР', visibility: 'group',
    })).rejects.toBeInstanceOf(ForbiddenException);
    await cloud.createFolder(ownerViewer, {
      name: 'ЛР', visibility: 'group',
    });
    expect(query.mock.calls.some(([sql, params]) =>
      String(sql).startsWith('INSERT INTO campus_cloud_folders') &&
      params[3] === 'А-03-23')).toBe(true);
  });

  test('strangers cannot download a private file', async () => {
    await expect(cloud.read(10, otherViewer))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(cloud.preview(10, otherViewer))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(cloud.save(otherViewer, 10, {}))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  test('group materials cannot be read outside verified group', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT * FROM campus_cloud_files')) {
        return [{ ...sample, visibility: 'group',
          group_code: 'А-03-23' }];
      }
      if (sql.startsWith('SELECT')) return [];
      return { insertId: 8, affectedRows: 1 };
    });
    await expect(cloud.read(10, otherViewer))
      .rejects.toBeInstanceOf(NotFoundException);
    await cloud.save({ key: stranger, group: 'А-03-23' }, 10, {});
    expect(query.mock.calls.some(([sql]) =>
      String(sql).startsWith('INSERT INTO campus_cloud_saved'))).toBe(true);
  });

  test('only owner can change sharing and generate a download link', async () => {
    await expect(cloud.changeVisibility(otherViewer, 10, {
      visibility: 'public',
    })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(cloud.createLink(otherViewer, 10))
      .rejects.toBeInstanceOf(ForbiddenException);
    const { token } = await cloud.createLink(ownerViewer, 10);
    expect(token.length).toBeGreaterThan(35);
    expect(query.mock.calls.some(([sql, params]) =>
      String(sql).startsWith('UPDATE campus_cloud_files SET share_hash') &&
      typeof params?.[0] === 'string' &&
      params[0] !== token && params[0].length === 64)).toBe(true);
  });

  test('only owner can rename the actual file, not another student', async () => {
    await expect(cloud.renameFile(otherViewer, 10, {
      name: 'Лабораторная.pdf',
    })).rejects.toBeInstanceOf(ForbiddenException);
    const result = await cloud.renameFile(ownerViewer, 10, {
      name: 'Лабораторная.pdf',
    });
    expect(result.name).toBe('Лабораторная.pdf');
    expect(query.mock.calls.some(([sql, params]) =>
      String(sql).startsWith('UPDATE campus_cloud_files SET name=?') &&
      params[0] === 'Лабораторная.pdf' && params[2] === owner)).toBe(true);
    await expect(cloud.renameFile(ownerViewer, 10, {
      name: 'fake.exe',
    })).rejects.toThrow('Расширение');
  });

  test('folder links are owner-only, revocable, and scoped to owned files',
      async () => {
    query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT * FROM campus_cloud_folders')) {
        return [{ id: 7, owner_key: owner, name: 'Физика',
          visibility: 'private', group_code: null }];
      }
      if (sql.startsWith('SELECT f.* FROM campus_cloud_folders')) {
        return [{ id: 7, owner_key: owner, name: 'Физика',
          visibility: 'private', group_code: null }];
      }
      if (sql.startsWith('SELECT id,name,size_bytes FROM')) {
        return [{ id: 10, name: 'Конспект.pdf', size_bytes: 400 }];
      }
      if (sql.startsWith('SELECT * FROM campus_cloud_files')) {
        return [{ ...sample, folder_id: 7 }];
      }
      if (sql.startsWith('SELECT')) return [];
      return { affectedRows: 1 };
    });

    await expect(cloud.createFolderLink(otherViewer, 7))
      .rejects.toBeInstanceOf(ForbiddenException);
    const link = await cloud.createFolderLink(ownerViewer, 7);
    expect(link.token.length).toBeGreaterThan(35);
    const result = await cloud.listSharedFolder(link.token);
    expect(result.name).toBe('Физика');
    expect(result.files).toEqual([{
      id: 10, name: 'Конспект.pdf', size: 400,
    }]);
    expect(query.mock.calls.some(([sql, params]) =>
      String(sql).startsWith('INSERT INTO campus_cloud_folder_links') &&
      params[0] === 7 && params[1] !== link.token &&
      typeof params[1] === 'string' && params[1].length === 64)).toBe(true);

    await expect(cloud.readSharedFolderFile(link.token, 12))
      .rejects.toBeInstanceOf(NotFoundException);
    await cloud.revokeFolderLink(ownerViewer, 7);
    expect(query.mock.calls.some(([sql]) =>
      String(sql).startsWith('DELETE FROM campus_cloud_folder_links'))).toBe(true);
  });

  test('root view does not flatten files that belong in folders', async () => {
    await cloud.list(ownerViewer, { mode: 'search' });
    const select = query.mock.calls.find(([sql]) =>
      String(sql).startsWith('SELECT f.*'));
    expect(select[0]).toContain('f.folder_id IS NULL');
    expect(select[0]).toContain('s.folder_id IS NULL');

    query.mockClear();
    await cloud.list(ownerViewer, { mode: 'search', q: 'ТАУ' });
    const searchSelect = query.mock.calls.find(([sql]) =>
      String(sql).startsWith('SELECT f.*'));
    expect(searchSelect[0]).not.toContain('f.folder_id IS NULL');
  });

  test('share links reject invalid and revoked tokens', async () => {
    await expect(cloud.readLink('guess'))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(cloud.readLink('A'.repeat(43)))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  test('unified folders include only owner, group or public', async () => {
    await cloud.folders(ownerViewer, 'all');
    const select = query.mock.calls.find(([sql]) =>
      String(sql).startsWith('SELECT * FROM campus_cloud_folders WHERE owner_key=?'));
    expect(select).toBeDefined();
    expect(select[0]).toContain("visibility='public'");
    expect(select[0]).toContain("visibility='group'");
    expect(select[1]).toEqual([owner, 'А-03-23']);
  });

  test('folder search combines name filtering with owner/group/public ACL', async () => {
    await cloud.folders(ownerViewer, 'all', 'Физика');
    const select = query.mock.calls.find(([sql]) =>
      String(sql).startsWith('SELECT * FROM campus_cloud_folders WHERE ('));
    expect(select).toBeDefined();
    expect(select[0]).toContain(
      "WHERE (owner_key=? OR visibility='public' OR (visibility='group'",
    );
    expect(select[0]).toContain('AND LOWER(name) LIKE ?');
    expect(select[1]).toEqual([owner, 'А-03-23', '%физика%']);
  });

  test('renaming a folder leaves its file access and share links unchanged', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT * FROM campus_cloud_folders')) {
        return [{
          id: 7, owner_key: owner, name: 'Старое',
          visibility: 'private', group_code: null,
        }];
      }
      if (sql.startsWith('SELECT')) return [];
      return { insertId: 8, affectedRows: 1 };
    });
    const result = await cloud.updateFolder(ownerViewer, 7, {
      name: 'Физика',
    });
    expect(result.name).toBe('Физика');
    expect(result.visibility).toBe('private');
    expect(query.mock.calls.some(([sql]) =>
      String(sql).startsWith('UPDATE campus_cloud_folders'))).toBe(true);
    expect(query.mock.calls.some(([sql]) =>
      String(sql).startsWith('UPDATE campus_cloud_files'))).toBe(false);
  });

  test('changing folder sharing updates file ACLs', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT * FROM campus_cloud_folders')) {
        return [{
          id: 7, owner_key: owner, name: 'Физика',
          visibility: 'private', group_code: null,
        }];
      }
      if (sql.startsWith('SELECT')) return [];
      return { insertId: 8, affectedRows: 1 };
    });
    const result = await cloud.updateFolder(ownerViewer, 7, {
      visibility: 'group',
    });
    expect(result.name).toBe('Физика');
    expect(result.visibility).toBe('group');
    expect(query.mock.calls.some(([sql, params]) =>
      String(sql).startsWith(
        'UPDATE campus_cloud_files SET visibility=?,group_code=?,share_hash=NULL',
      ) && params[0] === 'group' && params[1] === 'А-03-23')).toBe(true);
  });

  test('unified file listing includes own, group and public materials', async () => {
    await cloud.list(ownerViewer, { mode: 'search' });
    const select = query.mock.calls.find(([sql]) =>
      String(sql).startsWith('SELECT f.*'));
    expect(select).toBeDefined();
    expect(select[0]).toContain("f.visibility='public'");
    expect(select[0]).toContain("f.visibility='group'");
    expect(select[0]).toContain('OR f.owner_key=?');
    expect(select[0]).not.toContain('f.owner_key<>?');
    expect(select[1]).toEqual([owner, 'А-03-23', owner]);
  });

  test('search query uses server-side ACL constraints', async () => {
    await cloud.list(ownerViewer, { mode: 'discover', q: 'ЛР' });
    const select = query.mock.calls.find(([sql]) =>
      String(sql).startsWith('SELECT f.*'));
    expect(select).toBeDefined();
    expect(select[0]).toContain("f.visibility='public'");
    expect(select[0]).toContain("f.visibility='group'");
    expect(select[0]).toContain('f.owner_key<>?');
    expect(select[0]).toContain('LOWER(f.name) LIKE ?');
    expect(select[1]).toEqual([owner, 'А-03-23', owner, owner, '%лр%']);
  });
});
