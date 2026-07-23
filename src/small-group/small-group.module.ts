import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SmallGroup } from './entity/small-group.entity';
import { SmallGroupMember } from './entity/small-group-member.entity';
import { SmallGroupAttendance } from './entity/small-group-attendance.entity';
import { SmallGroupService } from './service/small-group.service';
import { SmallGroupAdminController } from './controller/small-group-admin.controller';
import { SmallGroupController } from './controller/small-group.controller';
import { UtilityModule } from '../utility/utility.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SmallGroup,
      SmallGroupMember,
      SmallGroupAttendance,
    ]),
    UtilityModule,
  ],
  providers: [SmallGroupService],
  controllers: [SmallGroupAdminController, SmallGroupController],
})
export class SmallGroupModule {}
