import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../auth/decorator/public.decorator';
import { EventService } from '../service/event.service';

// No login: the member app shows this when a shared event link is opened by someone who isn't signed in.
// The tenant comes from the host or X-Tenant-Subdomain, like the public Pages and Forms routes.
@Public()
@Controller('events/public')
export class EventPublicController {
  constructor(private readonly eventService: EventService) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':id')
  getPublicView(@Param('id', ParseUUIDPipe) id: string) {
    return this.eventService.getPublicView(id);
  }
}
