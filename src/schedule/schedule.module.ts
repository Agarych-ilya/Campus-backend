import { Module } from '@nestjs/common';

import { ScheduleController } from './schedule.controller';
import { ScheduleService } from './schedule.service';
import { RuzEntityService } from './ruz-entity.service';
import { RuzEntityController } from './ruz-entity.controller';

@Module({
    controllers: [ScheduleController, RuzEntityController],
    providers: [ScheduleService, RuzEntityService],
    exports: [ScheduleService],
})
export class ScheduleModule { }