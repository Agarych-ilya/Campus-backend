import { createHmac } from 'node:crypto';
import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
  ServiceUnavailableException, HttpException, HttpStatus,
} from '@nestjs/common';

import { DbService } from '../../db.service';
import {
  CreateListingDto, LISTING_KINDS, LOST_CATEGORIES,
  MARKET_CATEGORIES, ListingReportDto, UpdateListingDto,
} from './listings.dto';

type Kind = 'market' | 'lost' | 'found';
type ListingRow = {
  id: number;
  kind: Kind;
  category: string;
  title: string;
  description: string;
  price: number | null;
  condition_label: string | null;
  location: string | null;
  author_name: string;
  telegram: string;
  owner_key: string;
  status: string;
  photo_count: number;
  created_at: Date | string;
  updated_at: Date | string;
};

@Injectable()
export class ListingsService {
  constructor(private readonly db: DbService) {}

  private schemaPromise: Promise<void> | null = null;
  private readonly reportCooldown = new Map<string, number>();

  static ownerKey(recordBook: string): string {
    const secret = process.env.SESSION_SECRET?.trim();
    if (!secret || secret.length < 32) {
      throw new ServiceUnavailableException('Серверная авторизация не настроена');
    }
    return createHmac('sha256', secret)
      .update('campus-listing-owner-v1:' + recordBook)
      .digest('hex');
  }

  private async ensureSchema(): Promise<void> {
    if (!this.schemaPromise) {
      this.schemaPromise = (async () => {
        await this.db.query(
          'CREATE TABLE IF NOT EXISTS campus_listings (' +
          'id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, ' +
          "kind ENUM('market','lost','found') NOT NULL, " +
          'category VARCHAR(40) NOT NULL, ' +
          'title VARCHAR(120) NOT NULL, ' +
          'description TEXT NOT NULL, ' +
          'price INT UNSIGNED NULL, ' +
          'condition_label VARCHAR(16) NULL, ' +
          'location VARCHAR(120) NULL, ' +
          'author_name VARCHAR(60) NOT NULL, ' +
          'telegram VARCHAR(32) NOT NULL, ' +
          'owner_key CHAR(64) NOT NULL, ' +
          "status ENUM('active','closed') NOT NULL DEFAULT 'active', " +
          'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, ' +
          'updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ' +
          'ON UPDATE CURRENT_TIMESTAMP, ' +
          'INDEX idx_kind_status_created (kind, status, created_at), ' +
          'INDEX idx_owner_created (owner_key, created_at)' +
          ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
        );
        await this.db.query(
          'CREATE TABLE IF NOT EXISTS campus_listing_images (' +
          'listing_id BIGINT UNSIGNED NOT NULL, ' +
          'slot TINYINT UNSIGNED NOT NULL, ' +
          'mime VARCHAR(16) NOT NULL, ' +
          'data MEDIUMBLOB NOT NULL, ' +
          'PRIMARY KEY (listing_id, slot)' +
          ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
        );
        await this.db.query(
          'CREATE TABLE IF NOT EXISTS campus_listing_reports (' +
          'id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, ' +
          'listing_id BIGINT UNSIGNED NOT NULL, ' +
          'reason VARCHAR(16) NOT NULL, ' +
          'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, ' +
          'INDEX idx_listing_reports (listing_id)' +
          ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
        );
      })().catch((error: unknown) => {
        this.schemaPromise = null;
        throw error;
      });
    }
    await this.schemaPromise;
  }

  private validateFields(input: CreateListingDto | UpdateListingDto, kind: Kind) {
    const categories: readonly string[] = kind === 'market'
      ? MARKET_CATEGORIES : LOST_CATEGORIES;
    if (input.category !== undefined && !categories.includes(input.category)) {
      throw new BadRequestException('Некорректная категория объявления');
    }
    if (kind !== 'market' && (input.price !== undefined ||
        input.condition !== undefined)) {
      throw new BadRequestException('Цена и состояние доступны только в маркете');
    }
    if (kind === 'market' && input.price === undefined &&
        'kind' in input) {
      throw new BadRequestException('Укажи цену или 0 для бесплатной вещи');
    }
    if (input.telegram !== undefined &&
        !/^@?[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(input.telegram)) {
      throw new BadRequestException('Некорректное имя пользователя Telegram');
    }
    if (input.title !== undefined &&
        input.title.trim().length < 3) {
      throw new BadRequestException('Слишком короткое название');
    }
    if (input.description !== undefined &&
        input.description.trim().length < 10) {
      throw new BadRequestException('Описание слишком короткое');
    }
    if (input.authorName !== undefined &&
        input.authorName.trim().length < 2) {
      throw new BadRequestException('Укажи имя для объявления');
    }
    if (input.location !== undefined &&
        input.location.trim().length > 120) {
      throw new BadRequestException('Слишком длинное название места');
    }
  }

  private timestamp(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime())
      ? new Date(0).toISOString()
      : date.toISOString();
  }

  private present(row: ListingRow, ownerKey?: string) {
    const count = Math.max(0, Math.min(3, Number(row.photo_count) || 0));
    return {
      id: Number(row.id),
      kind: row.kind,
      category: row.category,
      title: row.title,
      description: row.description,
      price: row.price === null ? null : Number(row.price),
      condition: row.condition_label,
      location: row.location,
      authorName: row.author_name,
      telegram: row.telegram,
      status: row.status,
      isMine: !!ownerKey && row.owner_key === ownerKey,
      createdAt: this.timestamp(row.created_at),
      updatedAt: this.timestamp(row.updated_at),
      photoUrls: Array.from({ length: count }, (_, index) =>
        '/services/listings/' + row.id + '/photos/' + index),
    };
  }

  private readonly listingColumns =
    'SELECT l.*, (SELECT COUNT(*) FROM campus_listing_images img ' +
    'WHERE img.listing_id = l.id) AS photo_count FROM campus_listings l';

  async list(
    query: { kind?: string; category?: string; q?: string;
      mine?: string; sort?: string; free?: string },
    ownerKey?: string,
  ) {
    await this.ensureSchema();
    for (const value of [
      query.kind, query.category, query.q, query.mine,
      query.sort, query.free,
    ]) {
      if (value !== undefined && typeof value !== 'string') {
        throw new BadRequestException('Некорректные параметры поиска');
      }
    }
    const kind = query.kind ?? 'market';
    if (!LISTING_KINDS.includes(kind as Kind)) {
      throw new BadRequestException('Неверный тип объявлений');
    }
    const text = (query.q ?? '').trim();
    if (text.length > 80 || (query.category ?? '').length > 40) {
      throw new BadRequestException('Слишком длинный поисковый запрос');
    }
    const ownOnly = query.mine === 'true';
    if (ownOnly && !ownerKey) {
      throw new ForbiddenException('Для своих объявлений войди через БАРС');
    }
    if (query.mine !== undefined && !['true', 'false'].includes(query.mine)) {
      throw new BadRequestException('Некорректный фильтр объявлений');
    }
    if (query.sort && !['recent', 'price_asc', 'price_desc'].includes(query.sort)) {
      throw new BadRequestException('Некорректная сортировка');
    }
    if (query.free !== undefined &&
        !['true', 'false'].includes(query.free)) {
      throw new BadRequestException('Некорректный фильтр бесплатных вещей');
    }
    if (query.free === 'true' && kind !== 'market') {
      throw new BadRequestException('Бесплатные вещи доступны только в маркете');
    }
    if (query.sort?.startsWith('price') && kind !== 'market') {
      throw new BadRequestException('Сортировка по цене доступна только в маркете');
    }

    const conditions = ['l.kind = ?'];
    const params: unknown[] = [kind];
    if (ownOnly) {
      conditions.push('l.owner_key = ?');
      params.push(ownerKey!);
    } else {
      conditions.push("l.status = 'active'");
    }
    if (query.free === 'true') {
      conditions.push('l.price = 0');
    }
    if (query.category?.trim()) {
      const categories: readonly string[] = kind === 'market'
        ? MARKET_CATEGORIES : LOST_CATEGORIES;
      if (!categories.includes(query.category)) {
        throw new BadRequestException('Некорректная категория');
      }
      conditions.push('l.category = ?');
      params.push(query.category);
    }
    if (text) {
      conditions.push(
        "LOCATE(LOWER(?), LOWER(CONCAT_WS(' ', l.title, l.description, l.location))) > 0",
      );
      params.push(text);
    }
    const sort = query.sort === 'price_asc'
      ? 'l.price ASC, l.id DESC'
      : query.sort === 'price_desc'
        ? 'l.price DESC, l.id DESC'
        : 'l.id DESC';
    const rows = (await this.db.query(
      this.listingColumns + ' WHERE ' + conditions.join(' AND ') +
      ' ORDER BY ' + sort + ' LIMIT 80',
      params,
    )) as ListingRow[];
    return rows.map(row => this.present(row, ownerKey));
  }

  async one(id: number, ownerKey?: string) {
    await this.ensureSchema();
    const rows = (await this.db.query(
      this.listingColumns + ' WHERE l.id = ? LIMIT 1', [id],
    )) as ListingRow[];
    if (!rows.length) throw new NotFoundException('Объявление не найдено');
    const row = rows[0];
    if (row.status === 'closed' && row.owner_key !== ownerKey) {
      throw new NotFoundException('Объявление больше не активно');
    }
    return this.present(row, ownerKey);
  }

  private validatePhoto(file: Express.Multer.File): {
    mime: string; data: Buffer;
  } {
    const data = file.buffer;
    if (!Buffer.isBuffer(data) || data.length < 12 ||
        data.length > 5 * 1024 * 1024) {
      throw new BadRequestException('Фото должно быть размером до 5 МБ');
    }
    const png = data.subarray(0, 8).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    const jpeg = data[0] === 0xff && data[1] === 0xd8 &&
      data[2] === 0xff;
    const webp = data.toString('ascii', 0, 4) === 'RIFF' &&
      data.toString('ascii', 8, 12) === 'WEBP';
    if (!png && !jpeg && !webp) {
      throw new BadRequestException('Только PNG, JPG или WebP');
    }
    return { mime: png ? 'image/png' : jpeg ? 'image/jpeg' : 'image/webp', data };
  }

  async create(
    dto: CreateListingDto, ownerKey: string,
    photos: Express.Multer.File[] = [],
  ) {
    if (photos.length > 3) throw new BadRequestException('Не больше трёх фото');
    this.validateFields(dto, dto.kind);
    if (dto.kind !== 'market' && !dto.location?.trim()) {
      throw new BadRequestException('Укажи место, где потеряли или нашли вещь');
    }
    const validated = photos.map(file => this.validatePhoto(file));
    await this.ensureSchema();
    const existing = (await this.db.query(
      "SELECT COUNT(*) AS n FROM campus_listings " +
      "WHERE owner_key = ? AND status = 'active'",
      [ownerKey],
    )) as Array<{ n: number }>;
    if (Number(existing[0]?.n ?? 0) >= 20) {
      throw new BadRequestException('Не больше 20 активных объявлений');
    }
    const result = (await this.db.query(
      'INSERT INTO campus_listings ' +
      '(kind, category, title, description, price, condition_label, ' +
      'location, author_name, telegram, owner_key) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        dto.kind, dto.category, dto.title.trim(), dto.description.trim(),
        dto.kind === 'market' ? dto.price : null,
        dto.kind === 'market' ? dto.condition ?? null : null,
        dto.location?.trim() || null, dto.authorName.trim(),
        dto.telegram.replace(/^@/, ''), ownerKey,
      ],
    )) as { insertId: number };
    const id = Number(result.insertId);
    try {
      for (let i = 0; i < validated.length; i++) {
        await this.db.query(
          'INSERT INTO campus_listing_images ' +
          '(listing_id, slot, mime, data) VALUES (?, ?, ?, ?)',
          [id, i, validated[i].mime, validated[i].data],
        );
      }
    } catch (error) {
      await this.db.query(
        'DELETE FROM campus_listing_images WHERE listing_id = ?', [id],
      ).catch(() => undefined);
      await this.db.query(
        'DELETE FROM campus_listings WHERE id = ?', [id],
      ).catch(() => undefined);
      throw error;
    }
    return this.one(id, ownerKey);
  }

  async update(id: number, dto: UpdateListingDto, ownerKey: string) {
    await this.ensureSchema();
    const row = await this.requireOwner(id, ownerKey);
    this.validateFields(dto, row.kind);
    if (row.status !== 'active' && dto.status !== 'active') {
      throw new BadRequestException('Объявление закрыто');
    }
    const fields: string[] = [];
    const params: unknown[] = [];
    const changes: Array<[keyof UpdateListingDto, string]> = [
      ['title', 'title'], ['description', 'description'],
      ['category', 'category'], ['price', 'price'],
      ['condition', 'condition_label'], ['location', 'location'],
      ['authorName', 'author_name'], ['telegram', 'telegram'],
      ['status', 'status'],
    ];
    for (const [key, sql] of changes) {
      const value = dto[key];
      if (value === undefined) continue;
      fields.push(sql + ' = ?');
      params.push(typeof value === 'string'
        ? key === 'telegram'
          ? value.replace(/^@/, '').trim()
          : value.trim()
        : value);
    }
    if (fields.length === 0) return this.one(id, ownerKey);
    params.push(id, ownerKey);
    await this.db.query(
      'UPDATE campus_listings SET ' + fields.join(', ') +
      ' WHERE id = ? AND owner_key = ?',
      params,
    );
    return this.one(id, ownerKey);
  }

  private async requireOwner(id: number, ownerKey: string): Promise<ListingRow> {
    const rows = (await this.db.query(
      this.listingColumns + ' WHERE l.id = ? LIMIT 1', [id],
    )) as ListingRow[];
    if (!rows.length) throw new NotFoundException('Объявление не найдено');
    if (rows[0].owner_key !== ownerKey) {
      throw new ForbiddenException('Это объявление другого пользователя');
    }
    return rows[0];
  }

  async remove(id: number, ownerKey: string) {
    await this.ensureSchema();
    await this.requireOwner(id, ownerKey);
    await this.db.query(
      'DELETE FROM campus_listing_images WHERE listing_id = ?', [id],
    );
    await this.db.query(
      'DELETE FROM campus_listing_reports WHERE listing_id = ?', [id],
    );
    await this.db.query(
      'DELETE FROM campus_listings WHERE id = ? AND owner_key = ?',
      [id, ownerKey],
    );
    return { deleted: true };
  }

  async photo(id: number, slot: number) {
    await this.ensureSchema();
    if (slot < 0 || slot > 2) {
      throw new BadRequestException('Некорректный номер фото');
    }
    const rows = (await this.db.query(
      'SELECT img.mime, img.data FROM campus_listing_images img ' +
      'JOIN campus_listings l ON l.id = img.listing_id ' +
      "WHERE l.id = ? AND img.slot = ? AND l.status = 'active' LIMIT 1",
      [id, slot],
    )) as Array<{ mime: string; data: Buffer }>;
    if (!rows.length) throw new NotFoundException('Фото не найдено');
    return rows[0];
  }

  async report(id: number, dto: ListingReportDto, ip: string) {
    await this.one(id);
    const normalizedIp = ip.slice(0, 64);
    const key = normalizedIp + ':' + id;
    const now = Date.now();
    if (now - (this.reportCooldown.get(key) ?? 0) < 60 * 60 * 1000) {
      throw new HttpException('Жалоба уже отправлена', HttpStatus.TOO_MANY_REQUESTS);
    }
    await this.db.query(
      'INSERT INTO campus_listing_reports (listing_id, reason) VALUES (?, ?)',
      [id, dto.reason],
    );
    this.reportCooldown.set(key, now);
    if (this.reportCooldown.size > 2000) this.reportCooldown.clear();
    return { accepted: true };
  }
}
