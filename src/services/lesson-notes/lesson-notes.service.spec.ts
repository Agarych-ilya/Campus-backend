import {
  ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { DbService } from '../../db.service';
import { LessonNotesService } from './lesson-notes.service';

describe('LessonNotesService', () => {
  let notes: LessonNotesService;
  let query: jest.Mock;
  const scope = {
    group: 'А-03-23',
    date: '2026-11-03',
    time: '09:20 - 10:55',
    subject: 'Моделирование систем управления',
  };
  const ownerKey = 'a'.repeat(64);

  beforeEach(() => {
    query = jest.fn(async (sql: string) => {
      if (sql.startsWith('CREATE TABLE')) return [];
      if (sql.startsWith('SELECT COUNT')) return [{total: 0}];
      if (sql.startsWith('INSERT')) return {insertId: 3};
      if (sql.includes('WHERE id=? LIMIT 1')) {
        return [{
          id: 3,
          owner_key: ownerKey,
          content: 'Сделать лабораторную',
          created_at: new Date('2026-11-03T10:00:00Z'),
        }];
      }
      return [];
    });
    notes = new LessonNotesService({query} as unknown as DbService);
  });

  it('keeps notes within the exact group and lesson', async () => {
    await notes.list(scope);
    const selectCall = query.mock.calls.find(
      ([sql]) => (sql as string).startsWith('SELECT id, owner_key, content, created_at '),
    );
    expect(selectCall?.[1]).toEqual([
      scope.group, scope.date, scope.time, scope.subject,
    ]);
  });

  it('creates a shared note only with a server-provided owner key', async () => {
    const created = await notes.create({
      ...scope, content: '  Сделать лабораторную  ',
    }, ownerKey);
    expect(created.isMine).toBe(true);
    expect(created.content).toBe('Сделать лабораторную');
    const insert = query.mock.calls.find(
      ([sql]) => (sql as string).startsWith('INSERT'),
    );
    expect(insert?.[1]).toContain(ownerKey);
  });

  it('denies deleting another student note', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('CREATE')) return [];
      if (sql.startsWith('SELECT owner_key')) return [{owner_key: ownerKey}];
      return [];
    });
    await expect(notes.remove(3, 'b'.repeat(64)))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(query.mock.calls.some(
      ([sql]) => (sql as string).startsWith('DELETE'),
    )).toBe(false);
  });

  it('rejects missing content and invalid dates', async () => {
    await expect(notes.create({...scope, content: '   '}, ownerKey))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(notes.list({...scope, date: '2026-02-30'}))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
