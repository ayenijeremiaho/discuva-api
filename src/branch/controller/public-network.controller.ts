import { Controller, Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../auth/decorator/public.decorator';
import { NetworkService } from '../service/network.service';

// The network app's branch picker, before anyone signs in.
@Public()
@Controller('network/public')
export class PublicNetworkController {
  constructor(private readonly network: NetworkService) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get()
  get() {
    return this.network.publicNetwork();
  }
}
