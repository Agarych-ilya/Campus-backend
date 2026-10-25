import {
  BadRequestException,
  NotFoundException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DbService } from '../db.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { CommunityStatsService, MemberCountSource } from './community-stats.service';

export interface Community {
  id: string;
  title: string;
  username: string;
  subtitle: string;
  description: string;
  category: string;
  iconKind: string;
  memberCount: number | null;
  memberCountSource: MemberCountSource;
  memberCountCheckedAt: string | null;
  memberCountApproximate: boolean;
  iconUrl: string | null;
  telegramUrl: string | null;
  vkUrl: string | null;
}

export const featuredCommunities: readonly Community[] = [
  {
    id: 'mpeichat',
    title: 'Чат студентов МЭИ',
    username: 'mpeichat',
    subtitle: 'Общение, вопросы и студенческая жизнь',
    description:
      'Сообщество для общения студентов МЭИ: вопросы об учёбе, ' +
      'жизни университета и взаимопомощи. Перейди по ссылке, ' +
      'чтобы узнать актуальные правила и количество участников.',
    category: 'Студенческие чаты',
    iconKind: 'chat',
    memberCount: null,
    memberCountSource: null,
    memberCountCheckedAt: null,
    memberCountApproximate: false,
    iconUrl: null,
    telegramUrl: 'https://t.me/mpeichat',
    vkUrl: null,
  },
  {
    id: 'mpei_1kurs',
    title: 'Первый курс МЭИ',
    username: 'mpei_1kurs',
    subtitle: 'Для первокурсников',
    description:
      'Сообщество для первого курса: знакомство с вузом, вопросы ' +
      'о расписании, преподавателях и начале учёбы.',
    category: 'Первокурсникам',
    iconKind: 'study',
    memberCount: null,
    memberCountSource: null,
    memberCountCheckedAt: null,
    memberCountApproximate: false,
    iconUrl: null,
    telegramUrl: 'https://t.me/mpei_1kurs',
    vkUrl: null,
  },
  {
    id: 'MPEImai',
    title: 'Подслушано МЭИ',
    username: 'MPEImai',
    subtitle: 'Публикации и студенческие истории',
    description:
      'Студенческое сообщество с публикациями и историями ' +
      'из жизни МЭИ. Контент и правила доступны по ссылке.',
    category: 'Новости и мемы',
    iconKind: 'news',
    memberCount: null,
    memberCountSource: null,
    memberCountCheckedAt: null,
    memberCountApproximate: false,
    iconUrl: null,
    telegramUrl: 'https://t.me/MPEImai',
    vkUrl: null,
  },
  {
    id: 'mpeiuniversity',
    title: 'НИУ «МЭИ» | Официальный канал',
    username: 'mpeiuniversity',
    subtitle: 'Новости университета и объявления',
    description:
      'Официальный канал НИУ «МЭИ». Новости университета, мероприятия, ' +
      'объявления и важная информация для студентов и абитуриентов.',
    category: 'Новости университета',
    iconKind: 'campus',
    memberCount: null,
    memberCountSource: null,
    memberCountCheckedAt: null,
    memberCountApproximate: false,
    iconUrl: null,
    telegramUrl: 'https://t.me/mpeiuniversity',
    vkUrl: 'https://vk.com/mpei_ru',
  },
  {
    id: 'mpei_profcom',
    title: 'Профком студентов МЭИ',
    username: 'mpei_profcom',
    subtitle: 'Права, поддержка и возможности студентов',
    description:
      'Информационный канал профсоюзной организации обучающихся МЭИ. ' +
      'Новости, студенческие инициативы и полезные объявления.',
    category: 'Новости университета',
    iconKind: 'club',
    memberCount: null,
    memberCountSource: null,
    memberCountCheckedAt: null,
    memberCountApproximate: false,
    iconUrl: null,
    telegramUrl: 'https://t.me/mpei_profcom',
    vkUrl: 'https://vk.com/profcom_mpei',
  },
  {
    id: 'oss_mpei',
    title: 'Объединённый студсовет МЭИ',
    username: 'oss_mpei',
    subtitle: 'Студенческое самоуправление и события',
    description:
      'Объединённый студенческий совет МЭИ. Новости проектов, ' +
      'инициатив и мероприятий университетского сообщества.',
    category: 'Новости университета',
    iconKind: 'events',
    memberCount: null,
    memberCountSource: null,
    memberCountCheckedAt: null,
    memberCountApproximate: false,
    iconUrl: null,
    telegramUrl: 'https://t.me/oss_mpei',
    vkUrl: 'https://vk.com/oss_mpei',
  },
];

type CommunityRow = {
  id: number | string;
  title: string;
  description: string;
  category: string;
  icon_kind: string;
  icon_uploaded?: number | null;
  telegram_url: string | null;
  vk_url: string | null;
};

@Injectable()
export class ServicesService {
  private readonly logger = new Logger(ServicesService.name);
  private tableReady: Promise<void> | null = null;
  private readonly submissionsByIp = new Map<string, number>();
  private static readonly submitCooldownMs = 10 * 60 * 1000;

  constructor(
    private readonly db: DbService,
    private readonly stats: CommunityStatsService,
  ) {}

  /** Kept as a compatibility helper for the original Flutter client. */
  getTelegramGroups() {
    return featuredCommunities.map(({ title, username, subtitle }) => ({
      title,
      username,
      subtitle,
    }));
  }

  /**
   * Public catalog: built-in communities and manually approved submissions.
   * On DB outages fail closed so moderator-hidden groups stay hidden.
   */
  async getGroups(): Promise<Community[]> {
    let featured = featuredCommunities.map((community) => ({ ...community }));
    let approved: Community[] = featured;

    try {
      await this.ensureTable();
      const overrides = (await this.db.query(
        'SELECT id, title, description, category, icon_kind, ' +
          'telegram_url, vk_url, hidden FROM campus_featured_overrides',
      )) as Array<{
        id: string;
        title: string;
        description: string;
        category: string;
        icon_kind: string;
        telegram_url: string | null;
        vk_url: string | null;
        hidden: number;
      }>;
      const map = new Map(overrides.map((row) => [row.id, row]));
      const featuredIcons = (await this.db.query(
        'SELECT id FROM campus_featured_icons',
      )) as Array<{ id: string }>;
      const featuredIconIds = new Set(featuredIcons.map((row) => row.id));
      featured = featured.flatMap((original) => {
        const override = map.get(original.id);
        if (Boolean(override?.hidden)) return [];
        if (!override) {
          return [{
            ...original,
            iconUrl: featuredIconIds.has(original.id)
              ? '/services/groups/featured-icons/' + original.id + '?v=' + Date.now() : null,
          }];
        }
        return [{
          ...original,
          title: override.title,
          description: override.description,
          category: override.category,
          subtitle: override.category,
          iconKind: override.icon_kind,
          telegramUrl: override.telegram_url,
          vkUrl: override.vk_url,
          iconUrl: featuredIconIds.has(original.id)
            ? '/services/groups/featured-icons/' + original.id + '?v=' + Date.now() : null,
        }];
      });
      const rows = (await this.db.query(
        'SELECT c.id, c.title, c.description, c.category, c.icon_kind, ' +
          'c.telegram_url, c.vk_url, i.community_id AS icon_uploaded ' +
          'FROM campus_communities c LEFT JOIN campus_community_icons i ' +
          "ON i.community_id = c.id WHERE c.status = 'approved' " +
          'ORDER BY c.id DESC LIMIT 200',
      )) as CommunityRow[];

      const custom = rows.map((row): Community => {
        const telegramUrl = row.telegram_url;
        const username = telegramUrl
          ? this.telegramUsernameFromLink(telegramUrl)
          : '';

        return {
          id: 'community-' + String(row.id),
          title: row.title,
          username,
          subtitle: row.category,
          description: row.description,
          category: row.category,
          iconKind: row.icon_kind,
          memberCount: null,
          memberCountSource: null,
          memberCountCheckedAt: null,
          memberCountApproximate: false,
          iconUrl: row.icon_uploaded
            ? '/services/groups/icons/' + String(row.id) + '?v=' + Date.now()
            : null,
          telegramUrl,
          vkUrl: row.vk_url,
        };
      });

      approved = [...featured, ...custom];
    } catch (error) {
      this.logger.error(
        'Community catalog database unavailable; refusing stale seed fallback',
      );
      // The server cannot know which built-in groups an admin has hidden.
      // Failing closed prevents deleted groups from being republished.
      throw new ServiceUnavailableException(
        'Каталог сообществ временно недоступен',
      );
    }

    // Fetch at most 24 links per request, with concurrency limited to six.
    // Other entries remain visible without counts until later requests.
    const queue = approved.slice(0, 24);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(6, queue.length) }, async () => {
      while (cursor < queue.length) {
        const community = queue[cursor++];
        const updated = await this.stats.getMemberCount(
          community.telegramUrl,
          community.vkUrl,
        );
        community.memberCount = updated.memberCount;
        community.memberCountSource = updated.memberCountSource;
        community.memberCountCheckedAt = updated.memberCountCheckedAt;
        community.memberCountApproximate = updated.memberCountApproximate;
      }
    }));

    return approved;
  }

  /**
   * Anonymous suggestions are ALWAYS pending. They cannot overwrite
   * featured groups or become public without manual approval.
   */
  async submitCommunity(
    dto: CreateCommunityDto,
    clientIp: string,
    icon?: Express.Multer.File,
  ) {
    const title = dto.title.trim();
    const description = dto.description.trim();
    const category = dto.category;
    const iconKind = dto.iconKind;
    const verifiedIcon = icon ? this.validateIcon(icon) : null;

    if (title.length < 3 || description.length < 15) {
      throw new BadRequestException('Заполни название и описание сообщества');
    }

    const telegramUrl = this.normalizeSocialUrl(dto.telegramUrl, 'telegram');
    const vkUrl = this.normalizeSocialUrl(dto.vkUrl, 'vk');

    if (!telegramUrl && !vkUrl) {
      throw new BadRequestException('Добавь ссылку на Telegram или ВКонтакте');
    }

    const featuredLinks = featuredCommunities.flatMap((community) => [
      community.telegramUrl?.toLowerCase(),
      community.vkUrl?.toLowerCase(),
    ]);

    if (
      (telegramUrl && featuredLinks.includes(telegramUrl.toLowerCase())) ||
      (vkUrl && featuredLinks.includes(vkUrl.toLowerCase()))
    ) {
      throw new ConflictException('Это сообщество уже есть в каталоге');
    }

    const ipKey = clientIp || 'unknown';
    const now = Date.now();
    const previous = this.submissionsByIp.get(ipKey) ?? 0;

    if (now - previous < ServicesService.submitCooldownMs) {
      throw new HttpException(
        'Следующую заявку можно отправить через 10 минут',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      await this.ensureTable();

      const duplicates = (await this.db.query(
        "SELECT id FROM campus_communities WHERE status IN ('pending', 'approved') " +
          'AND ((telegram_url IS NOT NULL AND telegram_url = ?) ' +
          'OR (vk_url IS NOT NULL AND vk_url = ?)) LIMIT 1',
        [telegramUrl ?? '', vkUrl ?? ''],
      )) as Array<{ id: number }>;

      if (duplicates.length > 0) {
        throw new ConflictException(
          'Сообщество с такой ссылкой уже добавлено или ожидает проверки',
        );
      }

      const result = (await this.db.query(
        'INSERT INTO campus_communities ' +
          '(title, description, category, icon_kind, member_count, ' +
          "telegram_url, vk_url, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')",
        [
          title,
          description,
          category,
          iconKind,
          null, // Count always comes from Telegram or VK, never user input.
          telegramUrl,
          vkUrl,
        ],
      )) as { insertId: number };

      if (verifiedIcon) {
        try {
          await this.db.query(
            'INSERT INTO campus_community_icons ' +
              '(community_id, icon_mime, icon_data) VALUES (?, ?, ?)',
            [Number(result.insertId), verifiedIcon.mime, verifiedIcon.bytes],
          );
        } catch (error) {
          // Do not leave a pending record without its selected image.
          await this.db.query(
            'DELETE FROM campus_communities WHERE id = ? AND status = ?',
            [Number(result.insertId), 'pending'],
          ).catch(() => undefined);
          throw error;
        }
      }

      this.submissionsByIp.set(ipKey, now);
      if (this.submissionsByIp.size > 1000) {
        for (const [key, time] of this.submissionsByIp) {
          if (now - time > ServicesService.submitCooldownMs) {
            this.submissionsByIp.delete(key);
          }
        }
      }

      return {
        id: Number(result.insertId),
        status: 'pending' as const,
        message: 'Заявка отправлена на модерацию',
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;

      this.logger.warn('Community submission DB unavailable');
      throw new ServiceUnavailableException(
        'Сохранение заявок временно недоступно. Попробуй позже',
      );
    }
  }

  /**
   * Image bytes are checked independently of the filename and MIME header.
   * Only approved communities expose their images via the public endpoint.
   */
  validateIcon(file: Express.Multer.File) {
    const bytes = file.buffer;
    if (!Buffer.isBuffer(bytes) || bytes.length < 12 ||
        bytes.length > 700 * 1024) {
      throw new BadRequestException(
        'Иконка должна быть PNG, JPEG или WebP размером до 700 КБ',
      );
    }

    const png = bytes.subarray(0, 8).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    const jpeg = bytes[0] === 0xff &&
      bytes[1] === 0xd8 && bytes[2] === 0xff;
    const webp = bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP';

    const mime = png ? 'image/png'
      : jpeg ? 'image/jpeg'
      : webp ? 'image/webp'
      : null;

    if (!mime) {
      throw new BadRequestException(
        'Неподдерживаемый формат иконки. Выбери PNG, JPEG или WebP',
      );
    }

    return { mime, bytes };
  }

  async getFeaturedIcon(id: string): Promise<{ mime: string; data: Buffer }> {
    if (!featuredCommunities.some((community) => community.id === id)) {
      throw new NotFoundException('Сообщество не найдено');
    }

    await this.ensureTable();
    const rows = (await this.db.query(
      'SELECT i.icon_mime, i.icon_data FROM campus_featured_icons i ' +
        'LEFT JOIN campus_featured_overrides o ON o.id = i.id ' +
        'WHERE i.id = ? AND (o.hidden IS NULL OR o.hidden = 0) LIMIT 1',
      [id],
    )) as Array<{ icon_mime: string; icon_data: Buffer }>;

    if (rows.length === 0 || !Buffer.isBuffer(rows[0].icon_data)) {
      throw new NotFoundException('Иконка не найдена');
    }

    return { mime: rows[0].icon_mime, data: rows[0].icon_data };
  }

  async getPublicIcon(communityId: number): Promise<{ mime: string; data: Buffer }> {
    if (!Number.isSafeInteger(communityId) || communityId < 1) {
      throw new BadRequestException('Некорректный ID сообщества');
    }

    await this.ensureTable();
    const rows = (await this.db.query(
      'SELECT i.icon_mime, i.icon_data FROM campus_community_icons i ' +
        'JOIN campus_communities c ON c.id = i.community_id ' +
        "WHERE c.id = ? AND c.status = 'approved' LIMIT 1",
      [communityId],
    )) as Array<{ icon_mime: string; icon_data: Buffer }>;

    if (!rows.length || !Buffer.isBuffer(rows[0].icon_data)) {
      throw new NotFoundException('Иконка сообщества не найдена');
    }

    return { mime: rows[0].icon_mime, data: rows[0].icon_data };
  }

  private telegramUsernameFromLink(link: string): string {
    const path = new URL(link).pathname.split('/').filter(Boolean)[0] ?? '';
    return /^[a-zA-Z0-9_]{5,32}$/.test(path) ? path : '';
  }

  private normalizeSocialUrl(
    input: string | undefined,
    platform: 'telegram' | 'vk',
  ): string | null {
    const value = input?.trim();
    if (!value) return null;

    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BadRequestException('Используй полную HTTPS-ссылку на сообщество');
    }

    const allowed = platform === 'telegram'
      ? ['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me']
      : ['vk.com', 'www.vk.com'];

    if (
      url.protocol !== 'https:' ||
      !allowed.includes(url.hostname.toLowerCase()) ||
      url.port !== '' ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      throw new BadRequestException(
        'Поддерживаются только безопасные ссылки t.me и vk.com',
      );
    }

    const slug = url.pathname.replace(/^\/+|\/+$/g, '');
    if (!slug || !/^[a-zA-Z0-9_+.-]{1,120}$/.test(slug)) {
      throw new BadRequestException('Проверь ссылку на сообщество');
    }

    const host = platform === 'telegram' ? 't.me' : 'vk.com';
    return 'https://' + host + '/' + slug;
  }

  async ensureTable(): Promise<void> {
    if (this.tableReady === null) {
      this.tableReady = (async () => {
        await this.db.query(
          'CREATE TABLE IF NOT EXISTS campus_communities (' +
            'id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, ' +
            'title VARCHAR(80) NOT NULL, ' +
            'description TEXT NOT NULL, ' +
            'category VARCHAR(40) NOT NULL, ' +
            'icon_kind VARCHAR(20) NOT NULL, ' +
            'member_count INT UNSIGNED NULL, ' +
            'telegram_url VARCHAR(512) NULL, ' +
            'vk_url VARCHAR(512) NULL, ' +
            "status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending', " +
            'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, ' +
            'INDEX idx_community_status (status, created_at)' +
            ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
        );
        await this.db.query(
          'CREATE TABLE IF NOT EXISTS campus_community_icons (' +
            'community_id BIGINT UNSIGNED NOT NULL PRIMARY KEY, ' +
            'icon_mime VARCHAR(16) NOT NULL, ' +
            'icon_data MEDIUMBLOB NOT NULL' +
            ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
        );
        await this.db.query(
          'CREATE TABLE IF NOT EXISTS campus_featured_overrides (' +
            'id VARCHAR(64) NOT NULL PRIMARY KEY, ' +
            'title VARCHAR(80) NOT NULL, ' +
            'description TEXT NOT NULL, ' +
            'category VARCHAR(40) NOT NULL, ' +
            'icon_kind VARCHAR(20) NOT NULL, ' +
            'telegram_url VARCHAR(512) NULL, ' +
            'vk_url VARCHAR(512) NULL, ' +
            'hidden TINYINT(1) NOT NULL DEFAULT 0' +
            ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
        );
        await this.db.query(
          'CREATE TABLE IF NOT EXISTS campus_featured_icons (' +
            'id VARCHAR(64) NOT NULL PRIMARY KEY, ' +
            'icon_mime VARCHAR(16) NOT NULL, ' +
            'icon_data MEDIUMBLOB NOT NULL' +
            ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
        );
      })().catch((error: unknown) => {
        this.tableReady = null;
        throw error;
      });
    }

    await this.tableReady;
  }
}
