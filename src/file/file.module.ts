import { Module } from '@nestjs/common';
import { FileService } from './file.service';
import { FileController } from './file.controller';
import { DbService } from '../db.service';
import { CampusCloudService } from './campus-cloud.service';
import { CampusCloudController } from './campus-cloud.controller';
import { ListingsOwnerGuard } from '../services/listings/listings-owner.guard';

@Module({
  controllers: [FileController, CampusCloudController],
  providers: [FileService, CampusCloudService, DbService, ListingsOwnerGuard],
})
export class FileModule { }