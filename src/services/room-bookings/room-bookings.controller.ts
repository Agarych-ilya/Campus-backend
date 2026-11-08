import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Post, Query, Req, UseGuards, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { ListingsOwnerGuard } from '../listings/listings-owner.guard';
import { CreateRoomBookingDto, RoomBookingQueryDto } from './room-bookings.dto';
import { RoomBookingsService } from './room-bookings.service';

const validation = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

@Controller('services/room-bookings')
export class RoomBookingsController {
  constructor(private readonly bookings: RoomBookingsService) {}

  private sessionOwner(req: any): string | undefined {
    const session = req.session;
    const verifiedAt = session?.listingVerifiedAt;
    return typeof verifiedAt === 'number' && verifiedAt <= Date.now() &&
      Date.now() - verifiedAt < 24 * 60 * 60 * 1000 &&
      /^[a-f0-9]{64}$/.test(session?.listingOwnerKey ?? '')
      ? session.listingOwnerKey
      : undefined;
  }

  @Get()
  @UsePipes(validation)
  list(@Query() scope: RoomBookingQueryDto, @Req() req: any) {
    return this.bookings.availability(scope, this.sessionOwner(req));
  }

  @Post()
  @UseGuards(ListingsOwnerGuard)
  @UsePipes(validation)
  reserve(@Body() dto: CreateRoomBookingDto, @Req() req: any) {
    return this.bookings.reserve(dto, req.session.listingOwnerKey);
  }

  @Delete()
  @UseGuards(ListingsOwnerGuard)
  @HttpCode(HttpStatus.OK)
  @UsePipes(validation)
  cancel(@Query() scope: RoomBookingQueryDto, @Req() req: any) {
    return this.bookings.cancel(scope, req.session.listingOwnerKey);
  }
}
