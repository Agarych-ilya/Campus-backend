import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DbService } from '../../db.service';
import {
  Community,
  featuredCommunities,
  ServicesService,
} from '../services.service';
import { UpdateCommunityDto } from './community-admin.dto';

type CommunityStatus = 'pending' | 'approved' | 'rejected';

export interface CommunityAdminItem extends Community {
  status: CommunityStatus | 'hidden';
  builtIn: boolean;
}

type CustomRow = {
  id: number | string;
  title: string;
  description: string;
  category: string;
  icon_kind: string;
  telegram_url: string | null;
  vk_url: string | null;
  status: CommunityStatus;
  has_icon: number | string | null;
};

type OverrideRow = {
  id: string;
  title: string;
  description: string;
  category: string;
  icon_kind: string;
  telegram_url: string | null;
  vk_url: string | null;
  hidden: number;
};

@Injectable()
export class CommunityAdminService {
  constructor(
    private readonly db: DbService,
    private readonly services: ServicesService,
  ) {}

  async list(status: string = 'all'): Promise<CommunityAdminItem[]> {
    if (!['all', 'pending', 'approved', 'rejected', 'hidden'].includes(status)) {
      throw new BadRequestException('Неподдерживаемый статус');
    }
    await this.services.ensureTable();

    const overrides = (await this.db.query(
      'SELECT id, title, description, category, icon_kind, telegram_url, ' +
        'vk_url, hidden FROM campus_featured_overrides',
    )) as OverrideRow[];
    const overridesById = new Map(overrides.map((row) => [row.id, row]));
    const featuredIcons = (await this.db.query(
      'SELECT id FROM campus_featured_icons',
    )) as Array<{ id: string }>;
    const featuredIconIds = new Set(featuredIcons.map((row) => row.id));

    const seeds: CommunityAdminItem[] = featuredCommunities.map((base) => {
      const row = overridesById.get(base.id);
      return {
        ...base,
        title: row?.title ?? base.title,
        subtitle: row?.category ?? base.subtitle,
        description: row?.description ?? base.description,
        category: row?.category ?? base.category,
        iconKind: row?.icon_kind ?? base.iconKind,
        telegramUrl: row ? row.telegram_url : base.telegramUrl,
        vkUrl: row ? row.vk_url : base.vkUrl,
        iconUrl: featuredIconIds.has(base.id)
          ? '/services/groups/featured-icons/' + base.id + '?v=' + Date.now()
          : null,
        status: row?.hidden ? 'hidden' : 'approved',
        builtIn: true,
      };
    });

    const custom = (await this.db.query(
      'SELECT c.id, c.title, c.description, c.category, c.icon_kind, ' +
        'c.telegram_url, c.vk_url, c.status, ' +
        'i.community_id AS has_icon FROM campus_communities c ' +
        'LEFT JOIN campus_community_icons i ON i.community_id = c.id ' +
        'ORDER BY c.id DESC LIMIT 500',
    )) as CustomRow[];

    const entries: CommunityAdminItem[] = [
      ...seeds,
      ...custom.map((row) => ({
        id: 'community-' + String(row.id),
        title: row.title,
        username: '',
        subtitle: row.category,
        description: row.description,
        category: row.category,
        iconKind: row.icon_kind,
        telegramUrl: row.telegram_url,
        vkUrl: row.vk_url,
        memberCount: null,
        memberCountSource: null,
        memberCountCheckedAt: null,
        memberCountApproximate: false,
        iconUrl: row.has_icon
          ? '/services/admin/groups/icons/' + String(row.id) + '?v=' + Date.now()
          : null,
        status: row.status,
        builtIn: false,
      })),
    ];

    return status === 'all'
      ? entries
      : entries.filter((row) => row.status === status);
  }

  async review(id: number, status: 'approved' | 'rejected') {
    this.assertId(id);
    await this.services.ensureTable();

    const result = (await this.db.query(
      "UPDATE campus_communities SET status = ? WHERE id = ? AND status = 'pending'",
      [status, id],
    )) as { affectedRows?: number };

    if (!result.affectedRows) {
      throw new ConflictException(
        'Заявка не найдена или уже была обработана',
      );
    }

    return { id, status };
  }

  async update(id: string, dto: UpdateCommunityDto) {
    await this.services.ensureTable();
    const seed = featuredCommunities.find((item) => item.id === id);

    if (seed) {
      const existing = (await this.db.query(
        'SELECT id, title, description, category, icon_kind, ' +
          'telegram_url, vk_url, hidden FROM campus_featured_overrides ' +
          'WHERE id = ? LIMIT 1',
        [id],
      )) as OverrideRow[];

      const previous = existing[0];
      const next = {
        title: dto.title?.trim() ?? previous?.title ?? seed.title,
        description:
          dto.description?.trim() ?? previous?.description ?? seed.description,
        category: dto.category ?? previous?.category ?? seed.category,
        iconKind: dto.iconKind ?? previous?.icon_kind ?? seed.iconKind,
        telegramUrl: dto.telegramUrl !== undefined
          ? this.link(dto.telegramUrl, 't.me')
          : previous ? previous.telegram_url : seed.telegramUrl,
        vkUrl: dto.vkUrl !== undefined
          ? this.link(dto.vkUrl, 'vk.com')
          : previous ? previous.vk_url : seed.vkUrl,
        hidden: dto.hidden !== undefined
          ? Number(dto.hidden) : (previous?.hidden ?? 0),
      };
      this.verifyNext(next);

      await this.db.query(
        'INSERT INTO campus_featured_overrides ' +
          '(id, title, description, category, icon_kind, ' +
          'telegram_url, vk_url, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE title = VALUES(title), ' +
          'description = VALUES(description), category = VALUES(category), ' +
          'icon_kind = VALUES(icon_kind), telegram_url = VALUES(telegram_url), ' +
          'vk_url = VALUES(vk_url), hidden = VALUES(hidden)',
        [
          id, next.title, next.description, next.category, next.iconKind,
          next.telegramUrl, next.vkUrl, next.hidden,
        ],
      );

      return { id, status: next.hidden ? 'hidden' : 'approved' };
    }

    const numericId = this.customId(id);
    const existing = (await this.db.query(
      'SELECT id, title, description, category, icon_kind, ' +
        'telegram_url, vk_url, status FROM campus_communities ' +
        'WHERE id = ? LIMIT 1',
      [numericId],
    )) as CustomRow[];

    if (existing.length === 0) {
      throw new NotFoundException('Сообщество не найдено');
    }

    const current = existing[0];
    const next = {
      title: dto.title?.trim() ?? current.title,
      description: dto.description?.trim() ?? current.description,
      category: dto.category ?? current.category,
      iconKind: dto.iconKind ?? current.icon_kind,
      telegramUrl: dto.telegramUrl !== undefined
        ? this.link(dto.telegramUrl, 't.me') : current.telegram_url,
      vkUrl: dto.vkUrl !== undefined
        ? this.link(dto.vkUrl, 'vk.com') : current.vk_url,
    };
    this.verifyNext(next);

    if (dto.hidden !== undefined) {
      throw new BadRequestException(
        'Скрытие применяется только к встроенным сообществам',
      );
    }

    await this.db.query(
      'UPDATE campus_communities SET title = ?, description = ?, ' +
        'category = ?, icon_kind = ?, telegram_url = ?, vk_url = ? ' +
        'WHERE id = ?',
      [
        next.title, next.description, next.category, next.iconKind,
        next.telegramUrl, next.vkUrl, numericId,
      ],
    );
    return { id, status: current.status };
  }

  async remove(id: string) {
    const seed = featuredCommunities.find((item) => item.id === id);
    if (seed) {
      // Built-in communities are code-defined: persist a hide override.
      return this.update(id, { hidden: true });
    }

    const numericId = this.customId(id);
    await this.services.ensureTable();

    const existing = (await this.db.query(
      'SELECT id FROM campus_communities WHERE id = ? LIMIT 1',
      [numericId],
    )) as Array<{ id: number }>;

    if (existing.length === 0) {
      throw new NotFoundException('Сообщество не найдено');
    }

    await this.db.query(
      'DELETE FROM campus_community_icons WHERE community_id = ?',
      [numericId],
    );
    await this.db.query(
      'DELETE FROM campus_communities WHERE id = ?',
      [numericId],
    );

    return { id, deleted: true };
  }

  async updateIcon(id: string, file: Express.Multer.File | undefined) {
    if (!file) {
      throw new BadRequestException('Выбери изображение сообщества');
    }
    const icon = this.services.validateIcon(file);
    await this.services.ensureTable();

    const seed = featuredCommunities.find((item) => item.id === id);
    if (seed) {
      await this.db.query(
        'INSERT INTO campus_featured_icons (id, icon_mime, icon_data) ' +
          'VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE ' +
          'icon_mime = VALUES(icon_mime), icon_data = VALUES(icon_data)',
        [id, icon.mime, icon.bytes],
      );
      return { id, updated: true };
    }

    const numericId = this.customId(id);
    const rows = (await this.db.query(
      'SELECT id FROM campus_communities WHERE id = ? LIMIT 1',
      [numericId],
    )) as Array<{ id: number }>;
    if (!rows.length) throw new NotFoundException('Сообщество не найдено');

    await this.db.query(
      'INSERT INTO campus_community_icons ' +
        '(community_id, icon_mime, icon_data) VALUES (?, ?, ?) ' +
        'ON DUPLICATE KEY UPDATE ' +
        'icon_mime = VALUES(icon_mime), icon_data = VALUES(icon_data)',
      [numericId, icon.mime, icon.bytes],
    );
    return { id, updated: true };
  }

  /** Admin preview of unapproved images. This method is guard-protected. */
  async getIcon(id: number): Promise<{ mime: string; data: Buffer }> {
    this.assertId(id);
    await this.services.ensureTable();

    const rows = (await this.db.query(
      'SELECT icon_mime, icon_data FROM campus_community_icons ' +
        'WHERE community_id = ? LIMIT 1',
      [id],
    )) as Array<{ icon_mime: string; icon_data: Buffer }>;

    if (!rows.length || !Buffer.isBuffer(rows[0].icon_data)) {
      throw new NotFoundException('Иконка не найдена');
    }

    return { mime: rows[0].icon_mime, data: rows[0].icon_data };
  }

  private assertId(id: number) {
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new BadRequestException('Некорректный номер сообщества');
    }
  }

  private customId(id: string): number {
    const match = /^community-([1-9][0-9]*)$/.exec(id);
    if (!match) {
      throw new NotFoundException('Сообщество не найдено');
    }
    const numeric = Number(match[1]);
    this.assertId(numeric);
    return numeric;
  }

  private link(
    value: string | null | undefined,
    expectedHost: 't.me' | 'vk.com',
  ): string | null {
    if (value == null || value.trim() === '') return null;
    let url: URL;

    try {
      url = new URL(value.trim());
    } catch {
      throw new BadRequestException('Некорректная ссылка на соцсеть');
    }

    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      host !== expectedHost && host !== 'www.' + expectedHost ||
      url.port !== '' || url.username || url.password ||
      url.search || url.hash ||
      !/^\/[a-zA-Z0-9_.+-]{1,100}\/?$/.test(url.pathname)
    ) {
      throw new BadRequestException('Разрешены ссылки только t.me и vk.com');
    }

    return 'https://' + expectedHost + url.pathname.replace(/\/$/, '');
  }

  private verifyNext(next: {
    title: string;
    description: string;
    telegramUrl: string | null;
    vkUrl: string | null;
  }) {
    if (
      next.title.length < 3 || next.title.length > 80 ||
      next.description.length < 15 || next.description.length > 1200
    ) {
      throw new BadRequestException('Проверь длину названия и описания');
    }

    if (!next.telegramUrl && !next.vkUrl) {
      throw new BadRequestException('Оставь хотя бы одну ссылку на соцсеть');
    }
  }
}
