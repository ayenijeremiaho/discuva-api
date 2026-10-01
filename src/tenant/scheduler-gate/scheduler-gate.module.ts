import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../entity/tenant.entity';
import { SchedulerGateService } from './scheduler-gate.service';
import { SchedulerGateSubscriber } from './scheduler-gate.subscriber';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Tenant])],
  providers: [SchedulerGateService, SchedulerGateSubscriber],
  exports: [SchedulerGateService],
})
export class SchedulerGateModule {}
