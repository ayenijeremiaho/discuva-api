import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { Member } from '../member/entity/member.entity';
import { Admin } from '../admin/entity/admin.entity';
import {
  Campus,
  CampusAdmin,
  MemberCampusMove,
  WorkerCampusMoveRequest,
} from './campus.entity';
import { CampusAdminController, CampusController } from './campus.controller';
import { CampusService } from './campus.service';
import { CampusNotifier } from './campus-notifier.service';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      Campus,
      CampusAdmin,
      MemberCampusMove,
      WorkerCampusMoveRequest,
      Member,
      Admin,
    ]),
  ],
  controllers: [CampusController, CampusAdminController],
  providers: [CampusService, CampusNotifier],
  exports: [CampusService],
})
export class CampusModule {}
