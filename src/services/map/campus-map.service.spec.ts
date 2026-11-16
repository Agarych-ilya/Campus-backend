import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { DbService } from '../../db.service';
import { CommunityAdminGuard } from '../admin/community-admin.guard';
import { CampusMapController } from './campus-map.controller';
import { CampusMapService } from './campus-map.service';

describe('Campus map: persist markers and authorize changes', () => {
  const rows = new Map<string, any>();
  let migrated = false;
  let query: jest.Mock;
  let service: CampusMapService;

  beforeEach(() => {
    rows.clear();
    migrated = false;
    query = jest.fn(async (sql: string, params: any[] = []) => {
      if (sql.startsWith('CREATE TABLE')) return {};
      if (sql.startsWith('SELECT meta_key FROM campus_map_metadata')) {
        return migrated ? [{ meta_key: 'initial_markers_v1' }] : [];
      }
      if (sql.startsWith('INSERT IGNORE INTO campus_map_metadata')) {
        migrated = true;
        return { affectedRows: 1 };
      }
      if (sql.startsWith('INSERT IGNORE INTO campus_map_markers') ||
          sql.startsWith('INSERT INTO campus_map_markers')) {
        rows.set(params[0], {
          id: params[0], name: params[1], description: params[2],
          address: params[3], kind: params[4], latitude: params[5],
          longitude: params[6],
        });
        return { affectedRows: 1 };
      }
      if (sql.startsWith('SELECT id,name,description,address,kind,latitude,longitude') &&
          sql.includes('WHERE id=?')) {
        return rows.has(params[0]) ? [rows.get(params[0])] : [];
      }
      if (sql.startsWith('SELECT id,name,description,address,kind,latitude,longitude')) {
        return [...rows.values()].sort((a,b) => a.name.localeCompare(b.name));
      }
      if (sql.startsWith('UPDATE campus_map_markers')) {
        const old = rows.get(params[6]);
        if (!old) return { affectedRows: 0 };
        rows.set(params[6], {
          ...old, name: params[0], description: params[1],
          address: params[2], kind: params[3], latitude: params[4],
          longitude: params[5],
        });
        return { affectedRows: 1 };
      }
      if (sql.startsWith('DELETE FROM campus_map_markers')) {
        const had = rows.delete(params[0]);
        return { affectedRows: had ? 1 : 0 };
      }
      throw new Error('Unexpected SQL: ' + sql);
    });
    service = new CampusMapService({ query } as unknown as DbService);
  });

  test('seeds old MPEI places once and keeps deletes across reloads', async () => {
    const first = await service.list();
    expect(first).toHaveLength(7);
    expect(first.some(x => x.name === 'Корпус М')).toBe(true);
    await service.remove('seed-3');
    expect((await service.list()).some(x => x.id === 'seed-3')).toBe(false);

    const reloaded = new CampusMapService({ query } as unknown as DbService);
    expect((await reloaded.list()).some(x => x.id === 'seed-3')).toBe(false);
    expect(rows.size).toBe(6);
  });

  test('create, rename, reposition and remove live server marker', async () => {
    const original = await service.create({
      name: 'Корпус Е', kind: 'building', description: '',
      address: 'Москва', latitude: 55.755, longitude: 37.71,
    });
    expect(original.id).toMatch(/^[0-9a-f-]{36}$/);
    const edited = await service.update(original.id, {
      name: 'Корпус Е (новый)', latitude: 55.756, longitude: 37.712,
      kind: 'service',
    });
    expect(edited.name).toBe('Корпус Е (новый)');
    expect(edited.latitude).toBe(55.756);
    expect(edited.longitude).toBe(37.712);
    expect(edited.kind).toBe('service');
    expect((await service.list()).find(x => x.id === original.id)?.name)
      .toBe('Корпус Е (новый)');

    await service.remove(original.id);
    await expect(service.remove(original.id)).rejects
      .toBeInstanceOf(NotFoundException);
  });

  test('rejects invalid coordinates', async () => {
    await expect(service.create({
      name: 'Новая метка', description: '', address: '',
      kind: 'building', latitude: 100, longitude: 37,
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  test('GET is public; all three mutations require the existing admin guard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA,
      CampusMapController.prototype.list)).toBeUndefined();
    for (const action of ['create', 'update', 'remove'] as const) {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA, CampusMapController.prototype[action],
      ) as Array<unknown>;
      expect(guards).toContain(CommunityAdminGuard);
    }
  });
});
