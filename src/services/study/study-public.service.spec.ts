import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DbService } from '../../db.service';
import { StudyPublicService } from './study-public.service';

describe('StudyPublicService', () => {
  let query: jest.Mock;
  let service: StudyPublicService;
  const owner = 'a'.repeat(64);
  const visitor = 'b'.repeat(64);
  const cards = [
    {id: 'term1', term: 'Термин 1', definition: 'Определение 1'},
    {id: 'term2', term: 'Термин 2', definition: 'Определение 2'},
  ];
  const dto = {
    localDeckId: '17101000-0',
    title: 'Электротехника',
    description: 'Подготовка к экзамену',
    authorName: 'Студент МЭИ',
    cards,
  };

  const row = {
    id: 10,
    title: dto.title,
    description: dto.description,
    author_name: dto.authorName,
    owner_key: owner,
    card_count: 2,
    cards_json: JSON.stringify(cards),
    updated_at: new Date('2026-11-08T00:00:00.000Z'),
    rating: '4.5',
    rating_count: 2,
    my_rating: null,
  };

  beforeEach(() => {
    query = jest.fn(async (sql: string) => {
      if (sql.startsWith('CREATE TABLE')) return [];
      if (sql.startsWith('SELECT COUNT(*)')) return [{n: 0}];
      if (sql.includes('SELECT id FROM campus_study_public_decks')) {
        return [{id: 10}];
      }
      if (sql.startsWith('SELECT owner_key FROM')) {
        return [{owner_key: owner}];
      }
      if (sql.startsWith('SELECT d.')) return [{...row}];
      if (sql.startsWith('INSERT') || sql.startsWith('DELETE')) {
        return {affectedRows: 1};
      }
      throw new Error('Unexpected query: ' + sql);
    });
    service = new StudyPublicService({query} as unknown as DbService);
  });

  it('publishes cards bound to server-authenticated owner, not a client ID', async () => {
    const result = await service.publish(dto, owner);
    expect(result.isMine).toBe(true);
    expect(result.cardCount).toBe(2);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO campus_study_public_decks'),
      expect.arrayContaining([owner, dto.localDeckId, dto.title]),
    );
  });

  it('rejects duplicated card IDs', async () => {
    await expect(service.publish({
      ...dto, cards: [cards[0], cards[0]],
    }, owner)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows a student to rate someone else once via upsert', async () => {
    await service.rate(10, 5, visitor);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO campus_study_deck_ratings'),
      [10, visitor, 5],
    );
  });

  it('refuses self-ratings', async () => {
    await expect(service.rate(10, 5, owner))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses ratings outside 1..5', async () => {
    await expect(service.rate(10, 6, visitor))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not allow other students to remove a public deck', async () => {
    await expect(service.remove(10, visitor))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('searches all shared decks including card text', async () => {
    await service.list({q: 'термин', sort: 'popular'}, visitor);
    const called = query.mock.calls.find(
      ([sql]) => sql.includes('GROUP BY d.id ORDER BY'),
    );
    expect(called?.[0]).toContain('d.cards_json');
    expect(called?.[1]).toContain('термин');
  });
});
