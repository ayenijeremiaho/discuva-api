import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { Tenant } from '../tenant/entity/tenant.entity';
import { Subscription } from '../billing/entity/subscription.entity';
import { NetworkLevel } from './entity/network-level.entity';
import { NetworkMove } from './entity/network-move.entity';
import { NetworkTransfer } from './entity/network-transfer.entity';
import { NetworkTransferService } from './service/network-transfer.service';
import { NetworkTransferController } from './controller/network-transfer.controller';
import { Admin } from '../admin/entity/admin.entity';
import { MemberModule } from '../member/member.module';
import { AuthModule } from '../auth/auth.module';
import { TenantRollup } from './entity/tenant-rollup.entity';
import { Member } from '../member/entity/member.entity';
import { Attendance } from '../attendance/entity/attendance.entity';
import { TitheRecord } from '../tithe/entity/tithe-record.entity';
import { BranchController } from './controller/branch.controller';
import { BranchRollupService } from './service/branch-rollup.service';
import { NetworkService } from './service/network.service';
import { NetworkController } from './controller/network.controller';
import { PlatformNetworkController } from './controller/platform-network.controller';
import { PublicNetworkController } from './controller/public-network.controller';
import { TenantModule } from '../tenant/tenant.module';
import { BranchRollupScheduler } from './scheduler/branch-rollup.scheduler';

@Module({
  imports: [
    // Control-plane entities — public, never a search_path target.
    TypeOrmModule.forFeature([
      Tenant,
      NetworkLevel,
      NetworkMove,
      NetworkTransfer,
      TenantRollup,
      Subscription,
    ]),
    // Tenant-schema entities — only ever queried from inside
    // BranchRollupService's manually-entered tenant context, the same
    // reason every other module owning tenant-schema tables uses this
    // instead of plain TypeOrmModule.forFeature (docs/MULTI_TENANT_MIGRATION.md §4.4).
    TenantTypeOrmModule.forFeature([Member, Attendance, TitheRecord, Admin]),
    TenantModule,
    MemberModule,
    AuthModule,
  ],
  controllers: [
    BranchController,
    NetworkController,
    PublicNetworkController,
    PlatformNetworkController,
    NetworkTransferController,
  ],
  providers: [
    BranchRollupService,
    NetworkService,
    NetworkTransferService,
    BranchRollupScheduler,
  ],
  exports: [NetworkService],
})
export class BranchModule {}
