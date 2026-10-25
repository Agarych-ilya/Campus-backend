import {
    BadRequestException,
    Controller,
    Get,
    Query,
} from '@nestjs/common';

import { ScheduleService } from './schedule.service';

@Controller('schedule')
export class ScheduleController {
    constructor(
        private readonly scheduleService: ScheduleService,
    ) { }

    @Get('debug')
    getScheduleDebug(
        @Query('group') group?: string,
        @Query('date') date = this.getTodayDate(),
    ) {
        if (!group) {
            throw new BadRequestException('Не указана группа');
        }

        return this.scheduleService.getScheduleDebug(group, date);
    }

    @Get()
    getSchedule(
        @Query('group') group?: string,
        @Query('date') date = this.getTodayDate(),
    ) {
        if (!group) {
            throw new BadRequestException('Не указана группа');
        }

        return this.scheduleService.getSchedule(group, date);
    }

    private getTodayDate(): string {
        const today = new Date();

        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');

        return `${year}-${month}-${day}`;
    }
  }