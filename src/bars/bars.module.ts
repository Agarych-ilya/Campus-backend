import { Module } from '@nestjs/common';

import { BarsController } from './bars.controller';
import { BarsService } from './bars.service';
import { ScheduleModule } from '../schedule/schedule.module';

@Module({
    imports: [
        ScheduleModule,
    ],
    controllers: [
        BarsController,
    ],
    providers: [
        BarsService,
    ],
    exports: [
        BarsService,
    ],
})
export class BarsModule { }