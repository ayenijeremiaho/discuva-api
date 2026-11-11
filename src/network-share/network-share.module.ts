import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { Tenant } from '../tenant/entity/tenant.entity';
import { NETWORK_COPY_QUEUE } from './network-share.constants';
import { NetworkShareService } from './network-share.service';
import { NetworkShareSubscriber } from './network-share.subscriber';

// Global so announcements and events can share with branches without importing the network module (which imports them).
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([Tenant]),
    BullModule.registerQueue({ name: NETWORK_COPY_QUEUE }),
  ],
  providers: [NetworkShareService, NetworkShareSubscriber],
  exports: [NetworkShareService, BullModule],
})
export class NetworkShareModule {}
