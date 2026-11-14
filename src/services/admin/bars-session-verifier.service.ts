import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { normalizeBarsRecordBook } from '../../auth/admin_identity';

export interface VerifiedBarsStudent {
  recordBook: string;
  /** Group confirmed from the protected BARS student row. */
  group?: string;
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
  private readonly logger = new Logger(BarsSessionVerifier.name);

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
    } catch (error) {
      // Log only a fixed endpoint label and numeric HTTP status.
      // Never log cookies, full URLs, BARS HTML, or student identifiers.
      const stage = path.startsWith('/bars_web/ST/Student/ListStudent')
        ? 'student-list'
        : path.startsWith('/bars_web/ST_Study/Main/Main')
          ? 'study-profile'
          : 'student-profile';
      const status = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      this.logger.warn(
        'BARS admin verification: request-failed stage=' + stage +
        ' status=' + (typeof status === 'number' ? status : 'network-or-format'),
      );
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
    // BARS can render links either beneath /bars_web or at the site root.
    // Identify candidate student rows without relying on query-param order.
    // Their links are validated against a fixed allowlist of BARS routes below.
    const rows = $('#tbl__PartialListStudent tbody tr')
      .filter((_, row) =>
        $(row).find('a[href]').toArray().some((anchor) =>
          /(?:\/Student\/Main|^Main\?)/.test($(anchor).attr('href') ?? ''),
        ),
      );

    // Do not choose an arbitrary student from a multi-student staff/parent
    // account. BARS must show exactly one student for this session.
    if (rows.length !== 1) {
      this.logger.warn('BARS admin verification: student-list-rows-not-one');
      throw new UnauthorizedException(
        'БАРС не подтвердил единственный профиль студента',
      );
    }

    const row = rows.first();
    const links = row.find('a[href]').filter((_, anchor) =>
      /(?:\/Student\/Main|^Main\?)/.test($(anchor).attr('href') ?? ''),
    );
    const hrefs = links.toArray().map((anchor) => $(anchor).attr('href') ?? '');
    const cells = row.find('td');
    const listBook = normalizeBarsRecordBook(cells.eq(1).text());
    // The fourth cell belongs to this exact BARS student row, not to a
    // client-supplied or search-selected timetable. Fail closed if absent.
    const listGroupCandidate = cells.eq(3).text().replace(/\u00a0/g, ' ').trim();
    const listGroup = /^[A-ZА-ЯЁ0-9]+(?:-[A-ZА-ЯЁ0-9]+){1,3}$/i.test(listGroupCandidate)
      && listGroupCandidate.length <= 60
      ? listGroupCandidate.toUpperCase() : undefined;

    if (!listBook || listBook.length > 64 || cells.length < 4) {
      this.logger.warn('BARS admin verification: list-record-book-not-found');
      throw new UnauthorizedException('В БАРС не найден номер зачётки');
    }

    let detailsPath: string;
    // Diagnostic codes never contain cookies, full URLs, student IDs,
    // or record-book numbers.
    let rejectionReason = 'invalid-url';
    try {
      if (hrefs.length === 0) {
        rejectionReason = 'missing-link';
        throw new Error('Missing student link');
      }

      // Multiple buttons can link to the same BARS student. Validate *all*
      // candidate links and reject the row if any point to a different
      // student. The first link is never blindly trusted.
      const profiles = hrefs.map((href) => {
        if (!href) {
          rejectionReason = 'empty-link';
          throw new Error('Empty BARS profile link');
        }
        const url = new URL(
          href, this.origin + '/bars_web/ST/Student/ListStudent',
        );
        const pathname = url.pathname.replace(/\/$/, '');
        if (url.origin !== this.origin || url.username || url.password || url.hash) {
          rejectionReason = 'unexpected-origin-or-fragment';
          throw new Error('Unexpected BARS origin');
        }
        if (![
          '/bars_web/ST/Student/Main',
          '/ST/Student/Main',
        ].includes(pathname)) {
          rejectionReason = 'unexpected-path';
          throw new Error('Unexpected BARS profile path');
        }

        const studentIds = [...url.searchParams.entries()]
          .filter(([key]) => key.toLowerCase() === 'studentid')
          .map(([, value]) => value);
        if (studentIds.length !== 1) {
          rejectionReason = 'missing-or-ambiguous-id';
          throw new Error('Missing or ambiguous student ID');
        }
        const studentId = studentIds[0];
        const isIntegerId = /^\d{1,16}$/.test(studentId);
        const isGuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(studentId)
          || /^[0-9a-f]{32}$/i.test(studentId);
        if (!isIntegerId && !isGuid) {
          rejectionReason = 'unsupported-id-format';
          throw new Error('Invalid student ID format');
        }
        return { studentId, isGuid, pathname };
      });

      // GUID comparison is case-insensitive; numerical IDs are exact strings.
      const uniqueStudents = new Set(profiles.map((profile) =>
        profile.isGuid ? profile.studentId.toLowerCase() : profile.studentId,
      ));
      if (uniqueStudents.size !== 1) {
        rejectionReason = 'conflicting-student-links';
        throw new Error('Multiple student profiles in one row');
      }

      const { studentId, isGuid, pathname } = profiles[0];
      // Only BARS-provided, validated identifiers go to known BARS endpoints.
      // GUID study pages expose the record book in #div-FormHeader.
      detailsPath = isGuid
        ? '/bars_web/ST_Study/Main/Main?studentID=' + encodeURIComponent(studentId)
        : pathname + '?studentID=' + encodeURIComponent(studentId);
    } catch {
      this.logger.warn('Rejected BARS profile link (' + rejectionReason + ')');
      throw new UnauthorizedException('Некорректный профиль БАРС');
    }

    const details = await this.fetchBars(detailsPath, cookies);
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
      // No BARS page content or personally identifying values in logs.
      this.logger.warn('BARS admin verification: study-record-book-mismatch-or-missing');
      throw new UnauthorizedException('Профиль БАРС не прошёл проверку');
    }

    // Some BARS study pages also expose the group in the header. If both
    // independent BARS locations disagree, no group privilege is granted.
    const headerGroups = spans.toArray()
      .map((span) => $details(span).text().replace(/\u00a0/g, ' ').trim())
      .filter((text) => /^[A-ZА-ЯЁ0-9]+(?:-[A-ZА-ЯЁ0-9]+){1,3}$/i.test(text))
      .map((text) => text.toUpperCase());
    const comparable = (value: string) => value
      .replace(/A/g, 'А').replace(/[–—−]/g, '-');
    const headerAgrees = headerGroups.length === 0 ||
      (!!listGroup && headerGroups.every(
        (value) => comparable(value) === comparable(listGroup),
      ));
    return {
      recordBook: listBook,
      group: headerAgrees ? listGroup : undefined,
    };
  }
}
