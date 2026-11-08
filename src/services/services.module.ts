import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DbService } from '../db.service';
import { CommunityAdminController } from './admin/community-admin.controller';
import { CommunityAdminGuard } from './admin/community-admin.guard';
import { CommunityAdminService } from './admin/community-admin.service';
import { BarsSessionVerifier } from './admin/bars-session-verifier.service';
import { CommunityStatsService } from './community-stats.service';
import { ServicesController } from './services.controller';
import { ListingsController } from './listings/listings.controller';
import { ListingsService } from './listings/listings.service';
import { ListingsOwnerGuard } from './listings/listings-owner.guard';
import { StudyPublicController } from './study/study-public.controller';
import { StudyPublicService } from './study/study-public.service';
import { ServicesService } from './services.service';
import { LessonNotesController } from './lesson-notes/lesson-notes.controller';
import { LessonNotesService } from './lesson-notes/lesson-notes.service';

@Module({
  imports: [AuthModule],
  controllers: [ServicesController, CommunityAdminController, ListingsController, StudyPublicController, LessonNotesController],
  providers: [
    ServicesService,
    DbService,
    CommunityStatsService,
    CommunityAdminService,
    CommunityAdminGuard,
    BarsSessionVerifier,
    ListingsService,
    ListingsOwnerGuard,
    StudyPublicService,
    LessonNotesService,
  ],
})
export class ServicesModule {}
