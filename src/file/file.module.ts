import { Module } from '@nestjs/common';
import { FileService } from './file.service';
import { FileController } from './file.controller';
import { DbService } from '../db.service';
import { CampusCloudService } from './campus-cloud.service';
import { CampusCloudController } from './campus-cloud.controller';

@Module({
  controllers: [FileController, CampusCloudController],
  providers: [FileService, CampusCloudService, DbService],
})
export class FileModule { }