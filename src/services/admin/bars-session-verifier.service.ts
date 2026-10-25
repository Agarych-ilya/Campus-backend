import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { normalizeBarsRecordBook } from '../../auth/admin_identity';

export interface VerifiedBarsStudent {
  recordBook: string;
}

/**
 * Verifies an already authenticated BARS session directly against BARS.
 *
 * Do not accept a student name, record-book ID, HTML page or boolean supplied
 * by the phone. The backend fetches both pages itself over HTTPS using only
 * the session cookies. Both fixed BARS endpoints must agree on the record book.
 */
@Injectable()
export class BarsSessionVerifier {
  private readonly origin = 'https://bars.mpei.ru';

  private async fetchBars(path: string, cookies: string): Promise<string> {
    try {
      const response = await axios.get<string>(this.origin + path, {
        headers: {
          Cookie: cookies,
          Accept: 'text/html',
        },
        responseType: 'text',
        timeout: 8500,
        maxRedirects: 0,
        maxContentLength: 750 * 1024,
        validateStatus: (status) => status === 200,
      });
      if (typeof response.data !== 'string') {
        throw new Error('Unexpected BARS response');
      }
      return response.data;
    } catch {
      // Do not expose BARS session values or HTTP error details to clients.
      throw new UnauthorizedException(
        'Не удалось проверить сессию БАРС. Войди в БАРС ещё раз.',
      );
    }
  }

  async verify(cookies: string): Promise<VerifiedBarsStudent> {
    if (
      typeof cookies !== 'string' ||
      cookies.length < 5 ||
      cookies.length > 8192 ||
      /[\x00-\x1f\x7f]/.test(cookies) ||
      !cookies.split(';').every((part) =>
        /^\s*[!#$%&'*+.^_|~0-9A-Za-z-]+=[^;]*\s*$/.test(part))
    ) {
      throw new UnauthorizedException('Недопустимые cookie сессии БАРС');
    }

    const listing = await this.fetchBars(
      '/bars_web/ST/Student/ListStudent', cookies,
    );
    const $ = cheerio.load(listing);
    const rows = $('#tbl__PartialListStudent tbody tr')
      .filter((_, row) =>
        $(row).find('a[href*="/ST/Student/Main?studentID="]').length > 0,
      );

    // Do not choose an arbitrary student from a multi-student staff/parent
    // account. BARS must show exactly one student for this session.
    if (rows.length !== 1) {
      throw new UnauthorizedException(
        'БАРС не подтвердил единственный профиль студента',
      );
    }

    const row = rows.first();
    const link = row.find('a[href*="/ST/Student/Main?studentID="]').first();
    const href = link.attr('href');
    const cells = row.find('td');
    const listBook = normalizeBarsRecordBook(cells.eq(1).text());

    if (!href || cells.length < 4 || !listBook || listBook.length > 64) {
      throw new UnauthorizedException('В БАРС не найден номер зачётки');
    }

    let studentId: string;
    try {
      const url = new URL(href, this.origin);
      if (
        url.origin !== this.origin ||
        url.pathname !== '/bars_web/ST/Student/Main'
      ) {
        throw new Error('Unexpected profile link');
      }
      studentId = url.searchParams.get('studentID') ?? '';
      if (!/^\d{1,16}$/.test(studentId)) {
        throw new Error('Invalid student ID');
      }
    } catch {
      throw new UnauthorizedException('Некорректный профиль БАРС');
    }

    const details = await this.fetchBars(
      '/bars_web/ST/Student/Main?studentID=' + studentId,
      cookies,
    );
    const $details = cheerio.load(details);
    const spans = $details('#div-FormHeader span.fw-bold');

    const foundBooks: string[] = [];
    spans.each((_, span) => {
      const text = $details(span).text().replace(/\u00a0/g, ' ').trim();
      const match = text.match(
        /№\s*ЗК\s*[-–—:]?\s*([^)]+)\)/i,
      );
      if (match) {
        foundBooks.push(normalizeBarsRecordBook(match[1]));
      }
    });

    if (
      foundBooks.length !== 1 ||
      foundBooks[0] !== listBook ||
      !$details('#div-FormHeader').length
    ) {
      throw new UnauthorizedException('Профиль БАРС не прошёл проверку');
    }

    return { recordBook: listBook };
  }
}
