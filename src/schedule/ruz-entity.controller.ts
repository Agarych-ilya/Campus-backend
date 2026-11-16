import {Controller,Get,Query} from '@nestjs/common';
import {RuzEntityService} from './ruz-entity.service';

@Controller('schedule/ruz')
export class RuzEntityController {
  constructor(private readonly service:RuzEntityService) {}

  @Get('search')
  search(@Query('q') q='',@Query('type') type='person'){
    return this.service.search(q,type);
  }

  @Get('lessons')
  lessons(
    @Query('type') type:string,
    @Query('id') id:string,
    @Query('from') from:string,
    @Query('to') to:string,
  ){
    return this.service.schedule(type,id,from,to);
  }
}
