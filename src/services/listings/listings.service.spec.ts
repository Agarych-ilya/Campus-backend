import { ForbiddenException } from '@nestjs/common';

import { DbService } from '../../db.service';
import { ListingsService } from './listings.service';

describe('ListingsService', () => {
  let service: ListingsService;
  let query: jest.Mock;
  const owner = 'a'.repeat(64);
  const other = 'b'.repeat(64);

  const row = {
    id: 7,
    kind: 'market',
    category: 'Техника',
    title: 'Наушники',
    description: 'Работают отлично, есть коробка.',
    price: 950,
    condition_label: 'good',
    location: 'Корпус А',
    author_name: 'Иван К.',
    telegram: 'campus_ivan',
    owner_key: owner,
    status: 'active',
    photo_count: 0,
    created_at: new Date('2026-11-07T12:00:00.000Z'),
    updated_at: new Date('2026-11-07T12:00:00.000Z'),
  };

  beforeEach(() => {
    query = jest.fn(async (sql: string) => {
      if (sql.startsWith('CREATE TABLE')) return [];
      if (sql.startsWith('SELECT COUNT(*)')) return [{ n: 0 }];
      if (sql.startsWith('INSERT INTO campus_listings ')) {
        return { insertId: 7 };
      }
      if (sql.startsWith('SELECT l.*')) return [{ ...row }];
      if (sql.startsWith('UPDATE campus_listings')) return { affectedRows: 1 };
      if (sql.startsWith('DELETE')) return { affectedRows: 1 };
      throw new Error('Unexpected SQL: ' + sql);
    });
    service = new ListingsService({ query } as unknown as DbService);
  });

  it('creates a server-owned market listing without trusting client owner IDs', async () => {
    const created = await service.create({
      kind: 'market',
      title: row.title,
      description: row.description,
      category: row.category,
      price: 950,
      authorName: row.author_name,
      telegram: '@campus_ivan',
    }, owner);
    expect(created.id).toBe(7);
    expect(created.isMine).toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO campus_listings'),
      expect.arrayContaining(['market', 'Техника', 950, 'campus_ivan', owner]),
    );
  });

  it('rejects attempts to edit another user listing', async () => {
    await expect(service.update(7, { status: 'closed' }, other))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE campus_listings'),
      expect.anything(),
    );
  });

  it('marks an owned item sold and returns the owner-only view', async () => {
    await service.update(7, { status: 'closed' }, owner);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE campus_listings SET status = ?'),
      ['closed', 7, owner],
    );
  });

  it('never permits client-supplied categories outside the allowlist', async () => {
    await expect(service.create({
      kind: 'lost',
      title: 'Потерян студенческий',
      description: 'Потерян в аудитории, прошу написать владельцу.',
      category: 'Неизвестная категория',
      location: 'Корпус А',
      authorName: 'Иван К.',
      telegram: 'campus_ivan',
    }, owner)).rejects.toThrow('Некорректная категория объявления');
  });

  it('rejects malformed uploaded image data', async () => {
    await expect(service.create({
      kind: 'market',
      title: row.title,
      description: row.description,
      category: row.category,
      price: 950,
      authorName: row.author_name,
      telegram: 'campus_ivan',
    }, owner, [{
      buffer: Buffer.from('not-an-image'),
    } as Express.Multer.File])).rejects.toThrow('Только PNG, JPG или WebP');
  });

  it('uses keyed hash rather than storing the student record book', () => {
    const original = process.env.SESSION_SECRET;
    try {
      process.env.SESSION_SECRET = 'a'.repeat(40);
      const key = ListingsService.ownerKey('0000TEST123');
      expect(key).toMatch(/^[a-f0-9]{64}$/);
      expect(key).not.toContain('0000TEST123');
    } finally {
      if (original === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = original;
    }
  });
});
