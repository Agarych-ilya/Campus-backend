import { Module } from '@nestjs/common';
import { FileController } from './file.controller';
import { DbService } from '../db.service';
import { CampusCloudService } from './campus-cloud.service';
import { CampusCloudController } from './campus-cloud.controller';
import { ListingsOwnerGuard } from '../services/listings/listings-owner.guard';

@Module({
  controllers: [FileController, CampusCloudController],
  providers: [CampusCloudService, DbService, ListingsOwnerGuard],
})
export class FileModule { }