import {
  ConflictException, Injectable, Logger, ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';
import { normalizedStudyGroup } from '../lesson-notes/lesson-group-normalizer';
import type { BarsRosterStudentDto } from './attendance.dto';

const ORIGIN = 'https://bars.mpei.ru';
const LIST_PATH = '/bars_web/SG/StudyGroup/ListStudyGroup';
const EDIT_PATH = '/bars_web/SG/StudyGroup/EditStudyGroup';
const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const clean = (s: string) => s.normalize('NFC').replace(/\u00a0/g, ' ')
  .replace(/\s+/g, ' ').trim();

/** Validate HTML independently of the browser: refuse partial or ambiguous tables. */
export function parseBarsStudents(html: string, group: string): {
  students: BarsRosterStudentDto[];
  complete: boolean;
  found: boolean;
} {
  const $ = cheerio.load(html);
  // The authenticated BARS breadcrumb is the only trusted group label.
  const crumbs = $('.breadcrumb, ol.breadcrumb, [aria-label="breadcrumb"]')
    .toArray().map(el => clean($(el).text()));
  if (!crumbs.some(text => normalizedStudyGroup(text).includes(
    normalizedStudyGroup(group) + '.СТУДЕНТЫ'))) {
    throw new ConflictException('Не подтверждена страница студентов своей группы БАРС');
  }
  const tables = $('table').toArray().filter(table => {
    const labels = $(table).find('thead th').toArray()
      .map(th => clean($(th).text()).toLocaleLowerCase('ru-RU'));
    return labels.some(h => h === 'фио' || h.includes('ф.и.о')) &&
      labels.some(h => h.includes('статус обучения'));
  });
  if (!tables.length) return { students: [], complete: false, found: false };
  if (tables.length !== 1) throw new ConflictException('Несколько таблиц студентов БАРС');
  const table = $(tables[0]);
  const labels = table.find('thead th').toArray()
    .map(th => clean($(th).text()).toLocaleLowerCase('ru-RU'));
  const fioIndex = labels.findIndex(h => h === 'фио' || h.includes('ф.и.о'));
  const statusIndex = labels.findIndex(h => h.includes('статус обучения'));
  const emailIndex = labels.findIndex(h => h === 'почта' || h.includes('электронная почта'));
  const rows = table.find('tbody tr').toArray().filter(row =>
    $(row).children('td').length > Math.max(fioIndex, statusIndex));
  const students: BarsRosterStudentDto[] = [];
  const names = new Set<string>();
  for (const row of rows) {
    const cells = $(row).children('td');
    const status = clean(cells.eq(statusIndex).text()).toLocaleLowerCase('ru-RU');
    if (!status.includes('обучается') &&
        !status.includes('допущен к обучению')) continue;
    const fullName = clean(cells.eq(fioIndex).text());
    if (fullName.length < 5 || fullName.length > 120 ||
        !/^[\p{L} .'-]+$/u.test(fullName) || fullName.split(' ').length < 2) {
      throw new ConflictException('БАРС вернул некорректное ФИО');
    }
    const normalizedName = fullName.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
    if (names.has(normalizedName)) {
      throw new ConflictException('В БАРС обнаружены одинаковые ФИО');
    }
    names.add(normalizedName);
    let sourceId: string | undefined;
    for (const a of cells.eq(fioIndex).find('a[href]').toArray()) {
      try {
        const url = new URL($(a).attr('href')!, ORIGIN);
        if (url.origin !== ORIGIN || !url.pathname.startsWith('/bars_web/')) continue;
        const id = ['studentID', 'studentId', 'stID', 'studID']
          .map(key => url.searchParams.get(key)).find(Boolean);
        if (id && /^[a-zA-Z0-9_-]{1,120}$/.test(id)) { sourceId = id; break; }
      } catch { /* ignore invalid student anchor */ }
    }
    const emailMatch = emailIndex < 0 ? null : clean(cells.eq(emailIndex).text())
      .match(/\b[A-Za-z][A-Za-z0-9_.-]{2,63}@mpei\.ru\b/i);
    students.push({fullName, ...(sourceId ? {sourceId} : {}),
      ...(emailMatch ? {email: emailMatch[0].toLowerCase()} : {})});
  }
  const panel = table.closest('.dataTables_wrapper, .panel, .card, .box');
  const text = clean((panel.length ? panel : table.parent().parent()).text());
  const totalMatch = text.match(/Отображены\s*\d+\s*[-–]\s*\d+\s*запис[ьи]?\s*из\s*(\d+)/i) ||
    text.match(/из\s+(\d+)\s+запис[ьи]/i) ||
    text.match(/Показаны\s+записи\s+с\s+\d+\s+по\s+\d+\s+из\s+(\d+)/i);
  const total = totalMatch ? Number(totalMatch[1]) : null;
  // Fail closed if any page controls remain: 10 visible rows might be only page 1.
  const pagination = (panel.length ? panel : table.parent().parent())
    .find('.pagination a, .paginate_button, select').length > 0;
  const selects = (panel.length ? panel : table.parent().parent())
    .find('select').toArray();
  const expandedAll = selects.some(select => {
    const selected = $(select).find('option:selected');
    const value = selected.attr('value') ?? '';
    return value === '-1' || Number(value) >= 120 ||
      /все|all/i.test(clean(selected.text()));
  });
  const incomplete = (total !== null && rows.length !== total) ||
    (total === null && pagination && !expandedAll);
  if (rows.length > 120 || students.length > 120) {
    throw new ConflictException('Список БАРС превышает допустимые 120 студентов');
  }
  return { students, complete: !incomplete && students.length >= 3,
    found: true };
}

/**
 * Browser runs exclusively on backend; BARS cookies exist in memory only.
 * No POST is performed to official BARS journals, and no arbitrary URL from
 * the client is accepted. On missing/ambiguous HTML, refuse to import.
 */
@Injectable()
export class BarsRosterFetcher {
  private readonly logger = new Logger(BarsRosterFetcher.name);

  private checkBrowserLocation(actual: string, expectedPath?: string): void {
    let url: URL;
    try {
      url = new URL(actual);
    } catch {
      throw new UnauthorizedException('БАРС открыл неизвестную страницу');
    }
    if (url.origin !== ORIGIN) {
      throw new UnauthorizedException('БАРС перенаправил запрос на другой сайт');
    }
    if (/\/(?:Auth|Account)\/(?:Login|LogOn|SignIn)(?:\/|$)/i
        .test(url.pathname)) {
      throw new UnauthorizedException('Сессия БАРС истекла: требуется вход');
    }
    if (expectedPath && url.pathname.replace(/\/+$/, '') !== expectedPath) {
      throw new ConflictException('БАРС изменил адрес страницы учебной группы');
    }
  }

  async fetch(cookies: string, group: string): Promise<BarsRosterStudentDto[]> {
    if (!/^[А-ЯЁA-Z0-9]+(?:-[А-ЯЁA-Z0-9]+){1,3}$/.test(group)) {
      throw new ConflictException('Не подтверждена учебная группа');
    }
    const cookieEntries = cookies.split(';').map(fragment => {
      const pos = fragment.indexOf('=');
      if (pos < 1) throw new ConflictException('Некорректная сессия БАРС');
      const name = fragment.slice(0, pos).trim();
      const value = fragment.slice(pos + 1).trim();
      if (!/^[!#$%&'*+.^_|~0-9A-Za-z-]+$/.test(name) || !value ||
          /[\r\n;\x00]/.test(value)) {
        throw new ConflictException('Некорректная сессия БАРС');
      }
      return { name, value, url: ORIGIN };
    });
    let browser;
    try {
      browser = await chromium.launch({headless: true});
    } catch {
      this.logger.warn('BARS roster: chromium-unavailable');
      throw new ServiceUnavailableException(
        'На сервере не установлен Chromium для синхронизации БАРС',
      );
    }
    const context = await browser.newContext({serviceWorkers: 'block'});
    let stage = 'browser-start';
    try {
      await context.addCookies(cookieEntries);
      await context.route('**/*', route => {
        const req = route.request();
        let allowed = false;
        try {
          const url = new URL(req.url());
          allowed = url.protocol === 'https:' && url.origin === ORIGIN &&
            (req.method() === 'GET' ||
              (req.method() === 'POST' &&
              (url.pathname.startsWith('/bars_web/SG/StudyGroup/') ||
               url.pathname ===
                 '/bars_web/SG/Student/_PartialListStudyGroup__Students')));
        } catch { /* refuse invalid URL */ }
        return allowed ? route.continue() : route.abort();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      page.setDefaultNavigationTimeout(12000);
      stage = 'group-list';
      await page.goto(ORIGIN + LIST_PATH, {waitUntil: 'domcontentloaded'});
      this.checkBrowserLocation(page.url(), LIST_PATH);
      // The BARS group index may be populated by XHR after DOMContentLoaded.
      await page.waitForTimeout(900);
      const listHtml = await page.content();
      const $ = cheerio.load(listHtml);
      const matches = $('a[href]').toArray().flatMap(element => {
        if (normalizedStudyGroup(clean($(element).text())) !== group) return [];
        try {
          const url = new URL($(element).attr('href')!, ORIGIN);
          if (url.origin !== ORIGIN || url.pathname !== EDIT_PATH ||
              [...url.searchParams.keys()].some(key => key !== 'sgID')) return [];
          const values = url.searchParams.getAll('sgID');
          return values.length === 1 && UUID.test(values[0])
            ? [values[0].toLowerCase()] : [];
        } catch { return []; }
      });
      if (new Set(matches).size !== 1) {
        throw new ConflictException('Группа БАРС не найдена однозначно');
      }
      stage = 'group-details';
      await page.goto(ORIGIN + EDIT_PATH + '?sgID=' + encodeURIComponent(matches[0]),
        {waitUntil: 'domcontentloaded'});
      this.checkBrowserLocation(page.url(), EDIT_PATH);
      const link = page.getByText('Студенты', {exact: true});
      if (await link.count() !== 1) {
        throw new ConflictException('Не удалось найти вкладку «Студенты»');
      }
      stage = 'student-tab';
      await link.click();
      this.checkBrowserLocation(page.url());
      stage = 'student-table';
      const collected = new Map<string, BarsRosterStudentDto>();
      const visitedPages = new Set<string>();
      let expectedTotal: number | null = null;
      let lastError: Error | undefined;
      for (let attempt = 0; attempt < 18; attempt++) {
        await page.waitForTimeout(450);
        this.checkBrowserLocation(page.url());
        const html = await page.content();
        const result = parseBarsStudents(html, group);
        if (result.found && result.complete && collected.size === 0) {
          return result.students;
        }
        if (!result.found) continue;

        // First try displaying the entire table in one page, as before.
        // Only then use verified DataTables pagination.
        if (collected.size === 0) {
          try {
            const expanded = await page.evaluate(() => {
              const selects = Array.from(document.querySelectorAll('select'))
                .filter(select => {
                  const options = Array.from(select.options);
                  return options.some(option => option.value === '10') &&
                    options.some(option => Number(option.value) >= 50);
                });
              if (selects.length !== 1) return false;
              const select = selects[0];
              const options = Array.from(select.options)
                .filter(option => Number(option.value) >= 50)
                .sort((a,b) => Number(b.value)-Number(a.value));
              if (!options.length || select.value === options[0].value) return false;
              select.value = options[0].value;
              select.dispatchEvent(new Event('change',{bubbles:true}));
              return true;
            });
            if (expanded) continue;
          } catch { /* Page navigated during AJAX update. */ }
        }

        const $ = cheerio.load(html);
        const counter = $('.dataTables_info, [id$="_info"]').first().text();
        const foundTotal = counter.match(/(?:из|of)\s+(\d+)\s*(?:запис|entries|$)/i);
        if (foundTotal) {
          const total = Number(foundTotal[1]);
          if (!Number.isSafeInteger(total) || total < 3 || total > 120 ||
              (expectedTotal !== null && expectedTotal !== total)) {
            throw new ConflictException('Количество студентов БАРС изменилось');
          }
          expectedTotal = total;
        }
        // Every page must have both the verified group breadcrumb and a
        // complete identity for each student. Repeated pages are rejected.
        const signature = result.students.map(student =>
          student.sourceId || student.fullName.toLowerCase()).join('|');
        if (!signature || visitedPages.has(signature)) {
          throw new ConflictException('БАРС вернул повторяющуюся страницу');
        }
        visitedPages.add(signature);
        for (const student of result.students) {
          const key = student.sourceId || student.fullName
            .normalize('NFC').toLowerCase();
          const prior = collected.get(key);
          if (prior && (prior.fullName !== student.fullName ||
              prior.email !== student.email)) {
            throw new ConflictException('БАРС изменил студента между страницами');
          }
          collected.set(key,student);
        }
        if (collected.size > 120) {
          throw new ConflictException('Слишком много студентов группы');
        }
        if (expectedTotal !== null && collected.size === expectedTotal) {
          return [...collected.values()];
        }

        const next = page.locator(
          '.dataTables_paginate .next:not(.disabled), ' +
          '.pagination .next:not(.disabled), ' +
          'a.paginate_button.next:not(.disabled)',
        ).first();
        if (await next.count() !== 1) {
          lastError = new ConflictException(
            'Невозможно прочитать все страницы студентов БАРС',
          );
          break;
        }
        stage = 'student-pagination';
        await next.click();
        stage = 'student-table';
        lastError = new ConflictException('Не удалось получить полный список БАРС');
      }
      throw lastError ?? new ConflictException('Не найдена полная таблица БАРС');
    } catch (error) {
      // Log only fixed stage/type tags, never page URL, student names or cookies.
      const type = error instanceof UnauthorizedException ? 'session' :
        error instanceof ConflictException ? 'content' :
        error instanceof ServiceUnavailableException ? 'service' :
        error instanceof Error && error.name === 'TimeoutError'
          ? 'timeout' : 'navigation';
      this.logger.warn('BARS roster: fetch-or-parse-failed stage=' +
        stage + ' type=' + type);
      if (error instanceof ConflictException ||
          error instanceof UnauthorizedException ||
          error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(
        'Не удалось прочитать список БАРС (этап: ' + stage + ')',
      );
    } finally {
      await context.close();
      await browser.close();
    }
  }
}
