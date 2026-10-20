import {
    Injectable,
    NotFoundException,
} from '@nestjs/common';

import * as cheerio from 'cheerio';

@Injectable()
export class BarsService {
    extractGroupFromHtml(html: string): string {
        const $ = cheerio.load(html);

        const timetableLink = $(
            'a[href*="/bars_web/Open/RUZ/Timetable?rt=3"]',
        ).first();

        if (timetableLink.length > 0) {
            const href = timetableLink.attr('href');

            if (href) {
                const normalizedHref = href.replace(/&amp;/g, '&');

                const url = new URL(
                    normalizedHref,
                    'https://bars.mpei.ru',
                );

                const group = url.searchParams.get('name');

                if (group) {
                    return group.trim();
                }
            }
        }

        // Резервный вариант
        const text = $.text();

        const match = text.match(/[А-ЯЁA-Z]-\d{2}-\d{2}/u);

        if (match) {
            return match[0];
        }

        throw new NotFoundException(
            'Не удалось определить группу пользователя в БАРС',
        );
    }
  }