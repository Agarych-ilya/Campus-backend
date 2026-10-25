import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { AuthModule } from './auth/auth.module';
import { FileModule } from './file/file.module';
import { ScheduleModule } from './schedule/schedule.module';
import { BarsModule } from './bars/bars.module';
import { ServicesModule } from './services/services.module';

import { DbService } from './db.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    AuthModule,
    FileModule,
    ScheduleModule,
    BarsModule,
    ServicesModule,
  ],

  controllers: [AppController],

  providers: [
    AppService,
    DbService,
  ],
})
export class AppModule { }