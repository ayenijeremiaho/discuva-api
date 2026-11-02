import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { Member } from '../member/entity/member.entity';
import { Admin } from '../admin/entity/admin.entity';
import {
  Campus,
  MemberCampusMove,
  WorkerCampusMoveRequest,
} from './campus.entity';
import { CampusAdminController, CampusController } from './campus.controller';
import { CampusService } from './campus.service';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      Campus,
      MemberCampusMove,
      WorkerCampusMoveRequest,
      Member,
      Admin,
    ]),
  ],
  controllers: [CampusController, CampusAdminController],
  providers: [CampusService],
  exports: [CampusService],
})
export class CampusModule {}
