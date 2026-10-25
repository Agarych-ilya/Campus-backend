import { Injectable } from '@nestjs/common';

export interface TelegramGroup {
  title: string;
  username: string;
  subtitle: string;
}

/**
 * The public student-community directory.
 * Only explicitly curated public Telegram handles belong here.
 * No authentication credentials or private student data are returned.
 */
const telegramGroups: readonly TelegramGroup[] = Object.freeze([
  {
    title: 'Чат студентов МЭИ',
    username: 'mpeichat',
    subtitle: 'Telegram · общение студентов',
  },
  {
    title: 'Первый курс МЭИ',
    username: 'mpei_1kurs',
    subtitle: 'Telegram · первокурсники',
  },
  {
    title: 'Подслушано МЭИ',
    username: 'MPEImai',
    subtitle: 'Telegram · канал',
  },
]);

@Injectable()
export class ServicesService {
  getTelegramGroups(): readonly TelegramGroup[] {
    return telegramGroups;
  }
}
