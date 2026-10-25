import { Controller, Get } from '@nestjs/common';
import { ServicesService } from './services.service';

@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  /** Public, read-only directory used by CampusApp > Services > Groups. */
  @Get('groups')
  getGroups() {
    return this.servicesService.getTelegramGroups();
  }
}
