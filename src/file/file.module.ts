import { Module } from '@nestjs/common';
import { FileService } from './file.service';
import { FileController } from './file.controller';
import { DbService } from '../db.service';

@Module({
  controllers: [FileController],
  providers: [FileService, DbService],
})
export class FileModule {}
