import { Module } from '@nestjs/common';
import { DbService } from '../db.service';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';

@Module({
  controllers: [ServicesController],
  providers: [ServicesService, DbService],
})
export class ServicesModule {}
