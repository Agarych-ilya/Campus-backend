import {
  Injectable,
  Logger,
  ServiceUnavailableException,
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
    // Only call the two fixed BARS origins/paths. Never follow redirects:
    // a login redirect must not forward session cookies elsewhere.
    const stage = path.startsWith('/bars_web/ST/Student/ListStudent')
      ? 'student-list'
      : path.startsWith('/bars_web/ST_Study/Main/Main')
        ? 'study-profile'
        : 'student-profile';
    try {
      const response = await axios.get<string>(this.origin + path, {
        headers: {
          Cookie: cookies,
          Accept: 'text/html',
          'Accept-Language': 'ru-RU,ru;q=0.9',
          'User-Agent': 'Mozilla/5.0 CampusApp BARS session verification',
          Referer: this.origin + '/bars_web/Auth/Menu',
        },
        responseType: 'text',
        timeout: 9000,
        maxRedirects: 0,
        maxContentLength: 750 * 1024,
        validateStatus: (status) => status === 200,
      });
      if (typeof response.data !== 'string') {
        throw new Error('Invalid BARS response body');
      }
      return response.data;
    } catch (error) {
      // Never log cookies, redirects, full URLs, HTML, student IDs or books.
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const rawCode = axios.isAxiosError(error) ? error.code : undefined;
      const code = typeof rawCode === 'string' && /^[A-Z_]{2,40}$/.test(rawCode)
        ? rawCode : 'unknown';
      this.logger.warn(
        'BARS verification: request-failed stage=' + stage +
        ' status=' + (typeof status === 'number' ? status : 'none') +
        ' code=' + code,
      );
      if (status === 301 || status === 302 || status === 303 ||
          status === 307 || status === 308 || status === 401 ||
          status === 403) {
        // Safe troubleshooting details (no redirect URL or credentials).
        // A redirect could be a site change, not necessarily an expired
        // login, so never assert that the student's password was rejected.
        const stageName = stage === 'student-list'
          ? 'список студентов'
          : 'профиль студента';
        throw new UnauthorizedException(
          'БАРС не подтвердил сессию (' + stageName +
          ', HTTP ' + status + '). Открой «Обновить вход в БАРС» ' +
          'в учебном журнале. Если ошибка повторится, передай только ' +
          'этап проверки и HTTP-код.',
        );
      }
      if (status === 429 || (typeof status === 'number' && status >= 500) ||
          status === undefined) {
        throw new ServiceUnavailableException(
          'Не удалось связаться с БАРС для проверки сессии' +
          (typeof status === 'number' ? ' (HTTP ' + status + ')' : '') +
          '. Это может быть временная ошибка сети или сервера БАРС. ' +
          'Повтори проверку позже.',
        );
      }
      throw new UnauthorizedException(
        'БАРС не подтвердил сессию (HTTP ' + status + '). ' +
        'Проверь авторизацию в CampusApp.',
      );
    }
  }

  /**
   * Prove a starosta role from three BARS-protected pages, not from Flutter.
   * All URLs are fixed or validated BARS group links. On any ambiguity,
   * return false and do not grant attendance editing privileges.
   */
  async verifyStarosta(cookies: string, group: string | undefined): Promise<boolean> {
    if (!group || !/^[А-ЯЁA-Z0-9]+(?:-[А-ЯЁA-Z0-9]+){1,3}$/.test(group)) {
      return false;
    }
    const normalizeGroup = (value: string) => value
      .toUpperCase().replace(/A/g, 'А').replace(/[–—−]/g, '-')
      .replace(/\s+/g, '');
    const normalizeName = (value: string) => value
      .normalize('NFC').trim().toLocaleLowerCase('ru-RU')
      .replace(/\s+/g, ' ').replace(/ё/g, 'е');

    try {
      const menu = cheerio.load(await this.fetchBars('/bars_web/Auth/Menu', cookies));
      const accountLabel = menu('#ddMessage span.d-none.d-md-inline')
        .first().text().trim();
      const login = accountLabel.split('\\').pop() ?? '';
      if (!/^[A-Za-z][A-Za-z0-9_.-]{2,63}$/.test(login)) {
        this.logger.warn('BARS starosta verification: menu-login-missing');
        return false;
      }

      const list = cheerio.load(
        await this.fetchBars('/bars_web/SG/StudyGroup/ListStudyGroup', cookies),
      );
      const groupLinks = list('a[href]').toArray()
        .filter(el => normalizeGroup(list(el).text().trim()) === normalizeGroup(group))
        .map(el => list(el).attr('href') ?? '')
        .filter(href => href.includes('EditStudyGroup?'));
      const ids = new Set<string>();
      for (const href of groupLinks) {
        const url = new URL(href, this.origin);
        if (url.origin !== this.origin || url.username || url.password ||
            url.hash || url.pathname !== '/bars_web/SG/StudyGroup/EditStudyGroup' ||
            [...url.searchParams.keys()].some(k => k !== 'sgID')) continue;
        const id = url.searchParams.getAll('sgID');
        if (id.length === 1 &&
            /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id[0])) {
          ids.add(id[0].toLowerCase());
        }
      }
      if (ids.size !== 1) {
        this.logger.warn('BARS starosta verification: group-link-not-unique');
        return false;
      }
      const sgID = [...ids][0];
      const groupPage = cheerio.load(await this.fetchBars(
        '/bars_web/SG/StudyGroup/EditStudyGroup?sgID=' + encodeURIComponent(sgID),
        cookies,
      ));
      // Match only the field explicitly labeled "Староста".
      const label = groupPage('label, th, dt, div, span').toArray().find(el => {
        const wrapped = groupPage(el);
        return wrapped.children().length === 0 &&
          wrapped.text().trim().replace(/:$/, '') === 'Староста';
      });
      if (!label) {
        this.logger.warn('BARS starosta verification: starosta-field-missing');
        return false;
      }
      const $label = groupPage(label);
      const inputAndText = (el: ReturnType<typeof groupPage>) =>
        (el.text() + ' ' + el.find('input, textarea').toArray()
          .map(child => groupPage(child).attr('value') ?? '').join(' ')).trim();
      const candidate = [
        inputAndText($label.next()),
        inputAndText($label.parent().next()),
        inputAndText($label.closest('tr, .row, .form-group').first()),
      ].find(v => v.length > 3 && v.length < 400) ?? '';
      if (!candidate) {
        this.logger.warn('BARS starosta verification: starosta-name-missing');
        return false;
      }

      // This table also includes other journal maintainers. Their presence
      // alone is NOT sufficient: the person must be the named starosta above,
      // and the BARS account login must match their official email.
      const rows = groupPage('tr').toArray();
      const verified = rows.filter(row => {
        const cells = groupPage(row).find('td');
        if (cells.length < 5) return false;
        const name = [1, 2, 3].map(i => cells.eq(i).text().trim()).join(' ');
        const canonical = normalizeName(name);
        if (canonical.split(' ').filter(Boolean).length < 3 ||
            !normalizeName(candidate).includes(canonical)) return false;
        const addresses = groupPage(row).find('a[href^="mailto:"]').toArray()
          .map(el => (groupPage(el).attr('href') ?? '').slice(7))
          .filter(email => /^[A-Za-z0-9_.-]+@mpei\.ru$/i.test(email));
        return addresses.some(email =>
          email.split('@')[0].toLowerCase() === login.toLowerCase());
      });

      if (verified.length !== 1) {
        this.logger.warn('BARS starosta verification: identity-does-not-match');
        return false;
      }
      return true;
    } catch {
      // Missing permissions, HTML changes, or BARS downtime never turn into
      // a privileged session. The user may retry verification later.
      this.logger.warn('BARS starosta verification: protected-page-unavailable');
      return false;
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
