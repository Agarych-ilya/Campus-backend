import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbService } from '../db.service';
import { CommunityAdminController } from './admin/community-admin.controller';
import { CommunityAdminGuard } from './admin/community-admin.guard';
import { CommunityAdminService } from './admin/community-admin.service';
import { CommunityStatsService } from './community-stats.service';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';

@Module({
  imports: [AuthModule],
  controllers: [ServicesController, CommunityAdminController],
  providers: [
    ServicesService,
    DbService,
    CommunityStatsService,
    CommunityAdminService,
    CommunityAdminGuard,
  ],
})
export class ServicesModule {}
