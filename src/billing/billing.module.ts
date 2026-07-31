import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UtilityModule } from '../utility/utility.module';
import { Plan } from './entity/plan.entity';
import { Subscription } from './entity/subscription.entity';
import { PlanGuard } from './guard/plan.guard';

// Global, like AdminModule — PlanGuard is used via @UseGuards(PlanGuard) in
// controllers across many feature modules, the same cross-cutting shape as
// AdminGuard (docs/MULTI_TENANT_MIGRATION.md §4.11).
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Plan, Subscription]), UtilityModule],
  providers: [PlanGuard],
  exports: [PlanGuard, TypeOrmModule],
})
export class BillingModule {}
