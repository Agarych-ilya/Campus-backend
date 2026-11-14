import { ConflictException, ForbiddenException } from '@nestjs/common';
import { DbService } from '../db.service';
import { CampusCloudService } from './campus-cloud.service';

describe('Cloud folder -> private device migration', () => {
  const owner = 'a'.repeat(64);
  const other = 'b'.repeat(64);
  const viewer = { key: owner, group: 'А-03-23' };
  const folder = {
    id: 7, name: 'Практика', owner_key: owner,
    visibility: 'group', group_code: 'А-03-23',
  };
  const original = {
    id: 10, name: 'lecture.pdf', size_bytes: 100,
    path: '/outside/lecture.pdf', owner_key: owner,
    visibility: 'group', group_code: 'А-03-23',
  };
  const foreignBookmark = {
    id: 20, name: 'guide.pdf', size_bytes: 90,
    path: '/outside/guide.pdf', owner_key: other,
    visibility: 'public', group_code: null,
  };

  let query: jest.Mock;
  let execute: jest.Mock;
  let cloud: CampusCloudService;

  beforeEach(() => {
    query = jest.fn(async (sql: string) => {
      if (sql.startsWith('SELECT * FROM campus_cloud_folders')) {
        return [folder];
      }
      if (sql.startsWith('SELECT f.id,f.name,f.size_bytes,f.path')) {
        return [original, foreignBookmark];
      }
      return [];
    });
    execute = jest.fn(async (sql: string) => {
      if (sql.startsWith('SELECT owner_key FROM campus_cloud_folders')) {
        return [[{ owner_key: owner }], []];
      }
      if (sql.startsWith('SELECT f.id,f.name,f.size_bytes,f.path')) {
        return [[original, foreignBookmark], []];
      }
      return [{ affectedRows: 1 }, []];
    });
    const withTransaction = jest.fn(async (callback) => callback({execute}));
    cloud = new CampusCloudService(
      { query, withTransaction } as unknown as DbService,
    );
  });

  test('manifest contains own files and still accessible bookmarks', async () => {
    const result = await cloud.migrationManifest(viewer, 7);
    expect(result.name).toBe('Практика');
    expect(result.files).toEqual([
      { id: 10, name: 'lecture.pdf', size: 100, owned: true },
      { id: 20, name: 'guide.pdf', size: 90, owned: false },
    ]);
    await expect(cloud.migrationManifest({key: other}, 7))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  test('finalize revokes all owned links and folder row in one transaction',
      async () => {
    const result = await cloud.finishFolderMigration(viewer, 7, {
      fileIds: [20, 10],
    });
    expect(result).toEqual({migrated: true, deleted: 1, revoked: true});
    const statements = execute.mock.calls.map(([sql]) => String(sql));
    expect(statements.some(sql =>
      sql.startsWith('DELETE FROM campus_cloud_saved WHERE owner_key=?'))).toBe(true);
    expect(statements.some(sql =>
      sql.startsWith('DELETE FROM campus_cloud_saved WHERE file_id IN'))).toBe(true);
    expect(statements.some(sql =>
      sql.startsWith('DELETE FROM campus_cloud_files WHERE owner_key=?'))).toBe(true);
    expect(statements.some(sql =>
      sql.startsWith('DELETE FROM campus_cloud_folder_links'))).toBe(true);
    expect(statements.some(sql =>
      sql.startsWith('DELETE FROM campus_cloud_folders'))).toBe(true);
    // Foreign bookmarks are detached; foreign originals are never deleted.
    expect(execute.mock.calls.some(([sql, params]) =>
      String(sql).startsWith('DELETE FROM campus_cloud_saved WHERE file_id IN') &&
      params.length === 1 && params[0] === 10)).toBe(true);
  });

  test('a changed manifest fails before any deletion', async () => {
    await expect(cloud.finishFolderMigration(viewer, 7, {
      fileIds: [10],
    })).rejects.toBeInstanceOf(ConflictException);
    expect(execute.mock.calls.some(([sql]) =>
      String(sql).startsWith('DELETE'))).toBe(false);
  });

  test('an unauthorized user cannot finalize someone else\'s folder', async () => {
    await expect(cloud.finishFolderMigration({key: other}, 7, {
      fileIds: [10, 20],
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(execute.mock.calls.some(([sql]) =>
      String(sql).startsWith('DELETE'))).toBe(false);
  });
});
