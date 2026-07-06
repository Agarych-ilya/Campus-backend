import {
    Injectable,
    NotFoundException,
    ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';

type MpeiGroupSearchItem = {
    id: string | number;
};

export type ScheduleLesson = {
    date: string;
    time: string;
    subject: string;
    type: string;
    room: string;
    teacher: string;
};

type DebugRow = {
    index: number;
    classNames: string;
    rowText: string;
    dateText: string;
    time: string;
    subject: string;
    type: string;
    room: string;
    teacher: string;
};

@Injectable()
export class ScheduleService {
    async getSchedule(group: string, date: string) {
        const groupId = await this.getGroupId(group);

        const selectedDate = this.parseApiDate(date);
        const weekStart = this.getWeekStart(selectedDate);

        const lessons = await this.parseScheduleForWeek(
            groupId,
            weekStart,
        );

        return {
            group,
            date: this.formatDateForApi(weekStart),
            lessons,
        };
    }

    async getScheduleDebug(group: string, date: string) {
        const groupId = await this.getGroupId(group);

        const selectedDate = this.parseApiDate(date);
        const weekStart = this.getWeekStart(selectedDate);

        const siteDate = this.formatDateForMpei(weekStart);

        const url = `https://mpei.ru/Education/timetable/Pages/table.aspx?groupoid=${groupId}&start=${siteDate}`;

        const data = await this.loadMpeiPage(url);

        const $ = cheerio.load(data);

        const rows: DebugRow[] = [];

        $('tr').each((index, element) => {
            const row = $(element);

            rows.push({
                index,
                classNames: row.attr('class') ?? '',

                rowText: this.cleanText(
                    row.text(),
                ),

                dateText: this.cleanText(
                    row.find('.mpei-galaktika-lessons-grid-date').text(),
                ),

                time: this.cleanText(
                    row.find('.mpei-galaktika-lessons-grid-time').text(),
                ),

                subject: this.cleanText(
                    row.find('.mpei-galaktika-lessons-grid-name').text(),
                ),

                type: this.cleanText(
                    row.find('.mpei-galaktika-lessons-grid-type').text(),
                ),

                room: this.cleanText(
                    row.find('.mpei-galaktika-lessons-grid-room').text(),
                ),

                teacher: this.cleanText(
                    row.find('.mpei-galaktika-lessons-grid-pers').text(),
                ),
            });
        });

        return {
            group,
            groupId,
            date: this.formatDateForApi(weekStart),
            siteDate,
            url,
            rows,
        };
    }

    private async getGroupId(group: string): Promise<string> {
        const encodedGroup = encodeURIComponent(group);

        const url = `https://ts.mpei.ru/api/search?term=${encodedGroup}&type=group`;

        const { data } = await axios.get<MpeiGroupSearchItem[]>(url, {
            timeout: 15000,
            headers: {
                accept: 'application/json, text/plain, */*',
                'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
                'user-agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
                referer: 'https://ts.mpei.ru/ruz/main',
                connection: 'close',
            },
        });

        if (!Array.isArray(data) || data.length === 0) {
            throw new NotFoundException('Группа не найдена');
        }

        return String(data[0].id);
    }

    private async loadMpeiPage(url: string): Promise<string> {
        let lastError: unknown;

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const { data } = await axios.get<string>(url, {
                    timeout: 15000,
                    maxRedirects: 5,
                    headers: {
                        accept:
                            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                        'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
                        'user-agent':
                            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
                        referer: 'https://mpei.ru/Education/timetable/Pages/default.aspx',
                        connection: 'close',
                    },
                });

                return data;
            } catch (error) {
                lastError = error;

                await this.delay(600 * attempt);
            }
        }

        console.error('MPEI request failed:', lastError);

        throw new ServiceUnavailableException(
            'Не удалось получить расписание с сайта МЭИ',
        );
    }

    private async parseScheduleForWeek(
        groupId: string,
        weekStart: Date,
    ): Promise<ScheduleLesson[]> {
        const siteDate = this.formatDateForMpei(weekStart);

        const url = `https://mpei.ru/Education/timetable/Pages/table.aspx?groupoid=${groupId}&start=${siteDate}`;

        const data = await this.loadMpeiPage(url);

        const $ = cheerio.load(data);

        let currentDate = '';

        const lessons: ScheduleLesson[] = [];
        const addedLessons = new Set<string>();

        $('tr').each((index, element) => {
            const row = $(element);

            const dateText = this.cleanText(
                row.find('.mpei-galaktika-lessons-grid-date').first().text(),
            );

            const time = this.cleanText(
                row.find('.mpei-galaktika-lessons-grid-time').first().text(),
            );

            const subject = this.cleanText(
                row.find('.mpei-galaktika-lessons-grid-name').first().text(),
            );

            const type = this.cleanText(
                row.find('.mpei-galaktika-lessons-grid-type').first().text(),
            );

            const room = this.cleanText(
                row.find('.mpei-galaktika-lessons-grid-room').first().text(),
            );

            const teacher = this.cleanText(
                row.find('.mpei-galaktika-lessons-grid-pers').first().text(),
            );

            const timeIntervalCount = this.countTimeIntervals(time);
            const dateCount = this.countDatesInText(dateText);

            // Пропускаем большие сводные строки, где склеена вся неделя сразу.
            if (timeIntervalCount > 1 || dateCount > 1) {
                return;
            }

            // Строка-дата: "Пн, 1 июня", "Вт, 2 июня", "Сб, 6 июня".
            if (dateText && !time && !subject) {
                const parsedDate = this.getDateFromText(
                    dateText,
                    weekStart,
                );

                if (parsedDate) {
                    currentDate = parsedDate;
                }

                return;
            }

            // Строка-занятие.
            if (!time || !subject) {
                return;
            }

            if (timeIntervalCount !== 1) {
                return;
            }

            // На случай, если дата и занятие окажутся в одной строке.
            if (dateText) {
                const parsedDate = this.getDateFromText(
                    dateText,
                    weekStart,
                );

                if (parsedDate) {
                    currentDate = parsedDate;
                }
            }

            if (!currentDate) {
                return;
            }

            const lessonKey = [
                currentDate,
                time,
                subject,
                type,
                room,
                teacher,
            ].join('|');

            if (addedLessons.has(lessonKey)) {
                return;
            }

            addedLessons.add(lessonKey);

            lessons.push({
                date: currentDate,
                time,
                subject,
                type,
                room,
                teacher,
            });
        });

        return lessons.sort((firstLesson, secondLesson) => {
            const firstDate = this.parseClientDate(firstLesson.date);
            const secondDate = this.parseClientDate(secondLesson.date);

            if (firstDate && secondDate) {
                const dateDifference = firstDate.getTime() - secondDate.getTime();

                if (dateDifference !== 0) {
                    return dateDifference;
                }
            }

            return firstLesson.time.localeCompare(secondLesson.time);
        });
    }

    private getDateFromText(
        text: string,
        weekStart: Date,
    ): string | null {
        if (!text) {
            return null;
        }

        const dottedDate = this.getDateFromDottedText(
            text,
            weekStart,
        );

        if (dottedDate) {
            return dottedDate;
        }

        const russianDate = this.getDateFromRussianText(
            text,
            weekStart,
        );

        if (russianDate) {
            return russianDate;
        }

        return null;
    }

    private getDateFromDottedText(
        text: string,
        weekStart: Date,
    ): string | null {
        const match = text.match(
            /(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/,
        );

        if (!match) {
            return null;
        }

        const day = Number(match[1]);
        const month = Number(match[2]);

        if (!day || !month) {
            return null;
        }

        let year = weekStart.getFullYear();

        if (match[3]) {
            year = Number(match[3]);

            if (year < 100) {
                year += 2000;
            }
        }

        return this.formatDateForClient(
            new Date(year, month - 1, day),
        );
    }

    private getDateFromRussianText(
        text: string,
        weekStart: Date,
    ): string | null {
        const match = text.toLowerCase().match(
            /(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+(\d{4}))?/,
        );

        if (!match) {
            return null;
        }

        const day = Number(match[1]);
        const month = this.getMonthNumber(match[2]);

        if (!day || !month) {
            return null;
        }

        const year = match[3]
            ? Number(match[3])
            : weekStart.getFullYear();

        return this.formatDateForClient(
            new Date(year, month - 1, day),
        );
    }

    private countDatesInText(text: string): number {
        if (!text) {
            return 0;
        }

        const normalizedText = text.toLowerCase();

        const russianDateMatches = normalizedText.match(
            /(пн|вт|ср|чт|пт|сб|вс)?\s*,?\s*\d{1,2}\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/g,
        );

        if (russianDateMatches) {
            return russianDateMatches.length;
        }

        const dottedDateMatches = normalizedText.match(
            /\d{1,2}\.\d{1,2}(?:\.\d{2,4})?/g,
        );

        return dottedDateMatches?.length ?? 0;
    }

    private getMonthNumber(monthName: string): number | null {
        const months: Record<string, number> = {
            января: 1,
            февраля: 2,
            марта: 3,
            апреля: 4,
            мая: 5,
            июня: 6,
            июля: 7,
            августа: 8,
            сентября: 9,
            октября: 10,
            ноября: 11,
            декабря: 12,
        };

        return months[monthName] ?? null;
    }

    private countTimeIntervals(value: string): number {
        const matches = value.match(
            /\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}/g,
        );

        return matches?.length ?? 0;
    }

    private cleanText(value: string): string {
        return value
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private parseApiDate(date: string): Date {
        const [year, month, day] = date.split('-').map(Number);

        if (!year || !month || !day) {
            return new Date();
        }

        return new Date(year, month - 1, day);
    }

    private parseClientDate(date: string): Date | null {
        const match = date.match(
            /(\d{1,2})\.(\d{1,2})\.(\d{4})/,
        );

        if (!match) {
            return null;
        }

        const day = Number(match[1]);
        const month = Number(match[2]);
        const year = Number(match[3]);

        if (!day || !month || !year) {
            return null;
        }

        return new Date(year, month - 1, day);
    }

    private getWeekStart(date: Date): Date {
        const normalizedDate = new Date(
            date.getFullYear(),
            date.getMonth(),
            date.getDate(),
        );

        const dayOffset =
            normalizedDate.getDay() === 0
                ? 6
                : normalizedDate.getDay() - 1;

        normalizedDate.setDate(normalizedDate.getDate() - dayOffset);

        return normalizedDate;
    }

    private formatDateForApi(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');

        return `${year}-${month}-${day}`;
    }

    private formatDateForMpei(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');

        return `${year}.${month}.${day}`;
    }

    private formatDateForClient(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');

        return `${day}.${month}.${year}`;
    }

    private async delay(milliseconds: number): Promise<void> {
        return new Promise((resolve) => {
            setTimeout(resolve, milliseconds);
        });
    }
  }