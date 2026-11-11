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
import { BranchHistoryController } from './controller/branch-history.controller';
import { BranchHistoryService } from './service/branch-history.service';
import { NetworkVisitService } from './service/network-visit.service';
import { NetworkVisitController } from './controller/network-visit.controller';
import { NetworkVisitCode } from './entity/network-visit-code.entity';
import { NetworkVisitor } from './entity/network-visitor.entity';
import { TitheModule } from '../tithe/tithe.module';
import { VenueModule } from '../venue/venue.module';
import { AttendanceModule } from '../attendance/attendance.module';
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
      NetworkVisitCode,
      TenantRollup,
      Subscription,
    ]),
    // Tenant-schema entities — only ever queried from inside
    // BranchRollupService's manually-entered tenant context, the same
    // reason every other module owning tenant-schema tables uses this
    // instead of plain TypeOrmModule.forFeature (docs/MULTI_TENANT_MIGRATION.md §4.4).
    TenantTypeOrmModule.forFeature([
      Member,
      Attendance,
      TitheRecord,
      Admin,
      NetworkVisitor,
    ]),
    TenantModule,
    MemberModule,
    AuthModule,
    TitheModule,
    VenueModule,
    AttendanceModule,
  ],
  controllers: [
    BranchController,
    NetworkController,
    PublicNetworkController,
    PlatformNetworkController,
    NetworkTransferController,
    BranchHistoryController,
    NetworkVisitController,
  ],
  providers: [
    BranchRollupService,
    NetworkService,
    NetworkTransferService,
    BranchHistoryService,
    NetworkVisitService,
    BranchRollupScheduler,
  ],
  exports: [NetworkService],
})
export class BranchModule {}
