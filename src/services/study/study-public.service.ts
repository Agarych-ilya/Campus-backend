import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { DbService } from '../../db.service';
import { PublishStudyDeckDto } from './study-public.dto';

type PublicDeckRow = {
  id: number | string;
  title: string;
  description: string;
  author_name: string;
  owner_key: string;
  card_count: number;
  cards_json?: string;
  updated_at: Date | string;
  rating: number | string | null;
  rating_count: number | string;
  my_rating: number | string | null;
};

@Injectable()
export class StudyPublicService {
  constructor(private readonly db: DbService) {}

  private schema?: Promise<void>;

  private async ensureSchema() {
    if (!this.schema) {
      this.schema = (async () => {
        await this.db.query(
          'CREATE TABLE IF NOT EXISTS campus_study_public_decks (' +
          'id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, ' +
          'owner_key CHAR(64) NOT NULL, ' +
          'local_deck_id VARCHAR(100) NOT NULL, ' +
          'title VARCHAR(80) NOT NULL, ' +
          'description VARCHAR(300) NOT NULL, ' +
          'author_name VARCHAR(60) NOT NULL, ' +
          'card_count SMALLINT UNSIGNED NOT NULL, ' +
          'cards_json MEDIUMTEXT NOT NULL, ' +
          'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, ' +
          'updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ' +
          'ON UPDATE CURRENT_TIMESTAMP, ' +
          'UNIQUE KEY idx_owner_deck (owner_key, local_deck_id), ' +
          'INDEX idx_updated (updated_at)' +
          ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
        );
        await this.db.query(
          'CREATE TABLE IF NOT EXISTS campus_study_deck_ratings (' +
          'deck_id BIGINT UNSIGNED NOT NULL, ' +
          'rater_key CHAR(64) NOT NULL, ' +
          'stars TINYINT UNSIGNED NOT NULL, ' +
          'updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ' +
          'ON UPDATE CURRENT_TIMESTAMP, ' +
          'PRIMARY KEY (deck_id, rater_key), ' +
          'INDEX idx_deck (deck_id)' +
          ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
        );
      })().catch((error: unknown) => {
        this.schema = undefined;
        throw error;
      });
    }
    await this.schema;
  }

  private readonly columns =
    'SELECT d.id, d.title, d.description, d.author_name, d.owner_key, ' +
    'd.card_count, d.updated_at, ' +
    'ROUND(AVG(r.stars), 1) AS rating, COUNT(r.stars) AS rating_count, ' +
    'MAX(CASE WHEN r.rater_key = ? THEN r.stars ELSE NULL END) AS my_rating ' +
    'FROM campus_study_public_decks d ' +
    'LEFT JOIN campus_study_deck_ratings r ON r.deck_id = d.id ';

  private present(row: PublicDeckRow, ownerKey?: string) {
    return {
      id: Number(row.id),
      title: row.title,
      description: row.description,
      authorName: row.author_name,
      cardCount: Number(row.card_count),
      rating: row.rating == null ? 0 : Number(row.rating),
      ratingCount: Number(row.rating_count) || 0,
      myRating: row.my_rating == null ? null : Number(row.my_rating),
      isMine: !!ownerKey && row.owner_key === ownerKey,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async list(
    query: { q?: string; sort?: string },
    ownerKey?: string,
  ) {
    await this.ensureSchema();
    const { q = '', sort = 'recent' } = query;
    if (typeof q !== 'string' || q.length > 80 ||
        !['recent', 'popular'].includes(sort) ||
        typeof sort !== 'string') {
      throw new BadRequestException('Некорректные параметры поиска');
    }
    const where = q.trim()
      ? "WHERE LOCATE(LOWER(?), LOWER(CONCAT_WS(' ', " +
        "d.title, d.description, d.author_name, d.cards_json))) > 0 "
      : '';
    const params: unknown[] = [ownerKey ?? ''];
    if (q.trim()) params.push(q.trim());
    const order = sort === 'popular'
      ? 'rating DESC, rating_count DESC, d.updated_at DESC'
      : 'd.updated_at DESC';
    const result = (await this.db.query(
      this.columns + where + 'GROUP BY d.id ORDER BY ' + order + ' LIMIT 100',
      params,
    )) as PublicDeckRow[];
    return result.map(row => this.present(row, ownerKey));
  }

  async get(id: number, ownerKey?: string) {
    await this.ensureSchema();
    const rows = (await this.db.query(
      'SELECT d.*, ROUND(AVG(r.stars),1) AS rating, ' +
      'COUNT(r.stars) AS rating_count, ' +
      'MAX(CASE WHEN r.rater_key = ? THEN r.stars ELSE NULL END) AS my_rating ' +
      'FROM campus_study_public_decks d ' +
      'LEFT JOIN campus_study_deck_ratings r ON r.deck_id=d.id ' +
      'WHERE d.id=? GROUP BY d.id LIMIT 1',
      [ownerKey ?? '', id],
    )) as PublicDeckRow[];
    if (!rows.length) throw new NotFoundException('Набор не найден');
    let cards: unknown;
    try {
      cards = JSON.parse(rows[0].cards_json ?? '');
    } catch {
      throw new NotFoundException('Карточки набора недоступны');
    }
    return {...this.present(rows[0], ownerKey), cards};
  }

  async publish(dto: PublishStudyDeckDto, ownerKey: string) {
    await this.ensureSchema();
    if (dto.cards.length < 2 || dto.cards.length > 100 ||
        new Set(dto.cards.map(card => card.id)).size !== dto.cards.length ||
        dto.cards.some(card => !card.term.trim() ||
          !card.definition.trim() ||
          card.term.length > 180 || card.definition.length > 1200) ||
        !dto.title.trim() || !dto.authorName.trim()) {
      throw new BadRequestException('Проверь название и карточки набора');
    }
    const size = JSON.stringify(dto.cards);
    if (Buffer.byteLength(size, 'utf8') > 240000) {
      throw new BadRequestException('Слишком большой набор');
    }
    const count = (await this.db.query(
      'SELECT COUNT(*) AS n FROM campus_study_public_decks ' +
      'WHERE owner_key=?',
      [ownerKey],
    )) as Array<{ n: number }>;
    const exists = (await this.db.query(
      'SELECT id FROM campus_study_public_decks ' +
      'WHERE owner_key=? AND local_deck_id=? LIMIT 1',
      [ownerKey, dto.localDeckId],
    )) as Array<{ id: number }>;
    if (!exists.length && Number(count[0]?.n ?? 0) >= 30) {
      throw new BadRequestException('Не больше 30 общих наборов');
    }
    await this.db.query(
      'INSERT INTO campus_study_public_decks ' +
      '(owner_key,local_deck_id,title,description,author_name,' +
      'card_count,cards_json) VALUES (?,?,?,?,?,?,?) ' +
      'ON DUPLICATE KEY UPDATE title=VALUES(title), ' +
      'description=VALUES(description), ' +
      'author_name=VALUES(author_name), ' +
      'card_count=VALUES(card_count), cards_json=VALUES(cards_json)',
      [
        ownerKey, dto.localDeckId, dto.title.trim(),
        dto.description.trim(), dto.authorName.trim(),
        dto.cards.length, size,
      ],
    );
    const rows = (await this.db.query(
      'SELECT id FROM campus_study_public_decks ' +
      'WHERE owner_key=? AND local_deck_id=? LIMIT 1',
      [ownerKey, dto.localDeckId],
    )) as Array<{ id: number }>;
    return this.get(rows[0].id, ownerKey);
  }

  async rate(id: number, stars: number, ownerKey: string) {
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      throw new BadRequestException('Оценка должна быть от 1 до 5');
    }
    await this.ensureSchema();
    const rows = (await this.db.query(
      'SELECT owner_key FROM campus_study_public_decks WHERE id=? LIMIT 1',
      [id],
    )) as Array<{owner_key: string}>;
    if (!rows.length) throw new NotFoundException('Набор не найден');
    if (rows[0].owner_key === ownerKey) {
      throw new ForbiddenException('Свой набор оценивать нельзя');
    }
    await this.db.query(
      'INSERT INTO campus_study_deck_ratings ' +
      '(deck_id,rater_key,stars) VALUES (?,?,?) ' +
      'ON DUPLICATE KEY UPDATE stars=VALUES(stars)',
      [id, ownerKey, stars],
    );
    return this.get(id, ownerKey);
  }

  async remove(id: number, ownerKey: string) {
    await this.ensureSchema();
    const rows = (await this.db.query(
      'SELECT owner_key FROM campus_study_public_decks WHERE id=? LIMIT 1',
      [id],
    )) as Array<{owner_key: string}>;
    if (!rows.length) throw new NotFoundException('Набор не найден');
    if (rows[0].owner_key !== ownerKey) {
      throw new ForbiddenException('Удалить набор может только автор');
    }
    await this.db.query(
      'DELETE FROM campus_study_deck_ratings WHERE deck_id=?',
      [id],
    );
    await this.db.query(
      'DELETE FROM campus_study_public_decks WHERE id=? AND owner_key=?',
      [id, ownerKey],
    );
    return { deleted: true };
  }
}
