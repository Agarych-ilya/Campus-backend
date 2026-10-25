import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DbService } from '../db.service';
import { CreateCommunityDto } from './dto/create-community.dto';

export interface Community {
  id: string;
  title: string;
  username: string;
  subtitle: string;
  description: string;
  category: string;
  iconKind: string;
  memberCount: number | null;
  memberCountSource: 'self_reported' | 'telegram_snapshot' | null;
  memberCountAsOf?: string | null;
  telegramUrl: string | null;
  vkUrl: string | null;
}

const featuredCommunities: readonly Community[] = [
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
    memberCount: 2392,
    memberCountSource: 'telegram_snapshot',
    memberCountAsOf: '2026-10-25',
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
    memberCount: 12091,
    memberCountSource: 'telegram_snapshot',
    memberCountAsOf: '2026-10-25',
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
    memberCount: 2625,
    memberCountSource: 'telegram_snapshot',
    memberCountAsOf: '2026-10-25',
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
    memberCount: 2799,
    memberCountSource: 'telegram_snapshot',
    memberCountAsOf: '2026-10-25',
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
  member_count: number | null;
  telegram_url: string | null;
  vk_url: string | null;
};

@Injectable()
export class ServicesService {
  private readonly logger = new Logger(ServicesService.name);
  private tableReady: Promise<void> | null = null;
  private readonly submissionsByIp = new Map<string, number>();
  private static readonly submitCooldownMs = 10 * 60 * 1000;

  constructor(private readonly db: DbService) {}

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
   * Database outages never hide the built-in community links.
   */
  async getGroups(): Promise<Community[]> {
    const featured = featuredCommunities.map((community) => ({ ...community }));

    try {
      await this.ensureTable();
      const rows = (await this.db.query(
        "SELECT id, title, description, category, icon_kind, member_count, " +
          "telegram_url, vk_url FROM campus_communities " +
          "WHERE status = 'approved' ORDER BY id DESC LIMIT 200",
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
          memberCount:
            row.member_count === null ? null : Number(row.member_count),
          memberCountSource:
            row.member_count === null ? null : 'self_reported',
          memberCountAsOf: null,
          telegramUrl,
          vkUrl: row.vk_url,
        };
      });

      return [...featured, ...custom];
    } catch (error) {
      this.logger.warn('Community directory DB unavailable; serving built-in groups');
      return featured;
    }
  }

  /**
   * Anonymous suggestions are ALWAYS pending. They cannot overwrite
   * featured groups or become public without manual approval.
   */
  async submitCommunity(dto: CreateCommunityDto, clientIp: string) {
    const title = dto.title.trim();
    const description = dto.description.trim();
    const category = dto.category;
    const iconKind = dto.iconKind;

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
          dto.memberCount ?? null,
          telegramUrl,
          vkUrl,
        ],
      )) as { insertId: number };

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

  private async ensureTable(): Promise<void> {
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
      })().catch((error: unknown) => {
        this.tableReady = null;
        throw error;
      });
    }

    await this.tableReady;
  }
}
