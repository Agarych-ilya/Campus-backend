import { Module } from '@nestjs/common';

import { DbService } from '../db.service';
import { FileController } from './file.controller';
import { FileService } from './file.service';

@Module({
  controllers: [FileController],
  providers: [FileService, DbService],
})
export class FileModule { }