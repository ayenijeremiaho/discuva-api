import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { BullModule } from '@nestjs/bull';
import { TitheAccount } from './entity/tithe-account.entity';
import { TitheUploadBatch } from './entity/tithe-upload-batch.entity';
import { TitheRecord } from './entity/tithe-record.entity';
import { TitheUnmatchedRecord } from './entity/tithe-unmatched-record.entity';
import { TitheDisputeRecord } from './entity/tithe-dispute-record.entity';
import { TithePaymentProof } from './entity/tithe-payment-proof.entity';
import { TitheService } from './service/tithe.service';
import { TITHE_QUEUE, TitheProcessor } from './processor/tithe.processor';
import { TitheAdminController } from './controller/tithe-admin.controller';
import { TitheMemberController } from './controller/tithe-member.controller';
import { UtilityModule } from '../utility/utility.module';
import { AdminModule } from '../admin/admin.module';
import { Admin } from '../admin/entity/admin.entity';
import { Member } from '../member/entity/member.entity';
import { Tenant } from '../tenant/entity/tenant.entity';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      TitheAccount,
      TitheUploadBatch,
      TitheRecord,
      TitheUnmatchedRecord,
      TitheDisputeRecord,
      TithePaymentProof,
      Member,
      Admin,
    ]),
    // Tenant is public-schema, control-plane — plain TypeOrmModule, needed
    // by TitheService.purgeExpiredProofs' forEachActiveTenant loop.
    TypeOrmModule.forFeature([Tenant]),
    BullModule.registerQueue({ name: TITHE_QUEUE }),
    UtilityModule,
    AdminModule,
  ],
  controllers: [TitheAdminController, TitheMemberController],
  providers: [TitheService, TitheProcessor],
})
export class TitheModule {}
