import {
  Body,
  Controller,
  Post,
} from '@nestjs/common';

import { BarsService } from './bars.service';
import { ScheduleService } from '../schedule/schedule.service';

@Controller('bars')
export class BarsController {
  constructor(
    private readonly barsService: BarsService,
    private readonly scheduleService: ScheduleService,
  ) { }

  @Post('group-debug')
  getGroupDebug() {
    const html = `
      <span class="fw-bold">
        А-03-23
      </span>

      <a
        href="/bars_web/Open/RUZ/Timetable?rt=3&amp;name=%D0%90-03-23"
      >
        Расписание
      </a>
    `;

    return {
      group: this.barsService.extractGroupFromHtml(html),
    };
  }

  @Post('schedule-debug')
  async getScheduleDebug(
    @Body() body: {
      date?: string;
    },
  ) {
    /*
      Пока используем безопасный тестовый HTML.

      Он имитирует ту часть страницы БАРС,
      в которой находится ссылка на расписание группы.
    */
    const html = `
      <div id="div-FormHeader">
        <a
          href="/bars_web/Open/RUZ/Timetable?rt=3&amp;name=%D0%90-03-23"
        >
          <em>Расписание</em>
        </a>
      </div>
    `;

    // 1. Получаем группу из HTML БАРС
    const group =
      this.barsService.extractGroupFromHtml(html);

    // 2. Берём выбранную дату
    const date =
      body?.date ?? this.getTodayDate();

    // 3. Передаём найденную группу
    // в уже существующий ScheduleService
    const schedule =
      await this.scheduleService.getSchedule(
        group,
        date,
      );

    return {
      group,
      date,
      schedule,
    };
  }

  private getTodayDate(): string {
    const today = new Date();

    const year = today.getFullYear();

    const month = String(
      today.getMonth() + 1,
    ).padStart(2, '0');

    const day = String(
      today.getDate(),
    ).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }
}