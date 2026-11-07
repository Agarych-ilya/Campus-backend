import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, Req,
  UseGuards, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { ListingsOwnerGuard } from '../listings/listings-owner.guard';
import { PublishStudyDeckDto, RateStudyDeckDto } from './study-public.dto';
import { StudyPublicService } from './study-public.service';

const validation = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

@Controller('services/study')
export class StudyPublicController {
  constructor(private readonly study: StudyPublicService) {}

  private owner(req: any): string | undefined {
    const session = req.session;
    const at = session?.listingVerifiedAt;
    return typeof at === 'number' && at <= Date.now() &&
        Date.now() - at < 24 * 60 * 60 * 1000 &&
        /^[a-f0-9]{64}$/.test(session?.listingOwnerKey ?? '')
      ? session.listingOwnerKey
      : undefined;
  }

  @Get('decks')
  list(
    @Query() query: {q?: string; sort?: string},
    @Req() req: any,
  ) {
    return this.study.list(query, this.owner(req));
  }

  @Get('decks/:id')
  get(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.study.get(id, this.owner(req));
  }

  @Post('decks')
  @UseGuards(ListingsOwnerGuard)
  @UsePipes(validation)
  publish(@Body() dto: PublishStudyDeckDto, @Req() req: any) {
    return this.study.publish(dto, req.session.listingOwnerKey);
  }

  @Post('decks/:id/rating')
  @UseGuards(ListingsOwnerGuard)
  @UsePipes(validation)
  rate(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RateStudyDeckDto,
    @Req() req: any,
  ) {
    return this.study.rate(id, dto.stars, req.session.listingOwnerKey);
  }

  @Delete('decks/:id')
  @UseGuards(ListingsOwnerGuard)
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.study.remove(id, req.session.listingOwnerKey);
  }
}
