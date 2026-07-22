import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChildAgeGroup } from './entity/child-age-group.entity';
import { ChildClassGroup } from './entity/child-class-group.entity';
import { ChildProfile } from './entity/child-profile.entity';
import { ChildGuardian } from './entity/child-guardian.entity';
import { ChildCheckIn } from './entity/child-check-in.entity';
import { ChildrenChurchService } from './service/children-church.service';
import { ChildrenChurchController } from './controller/children-church.controller';
import { MemberModule } from '../member/member.module';
import { EventModule } from '../event/event.module';
import { UtilityModule } from '../utility/utility.module';
import { DepartmentModule } from '../department/department.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChildAgeGroup,
      ChildClassGroup,
      ChildProfile,
      ChildGuardian,
      ChildCheckIn,
    ]),
    MemberModule,
    EventModule,
    UtilityModule,
    DepartmentModule,
  ],
  controllers: [ChildrenChurchController],
  providers: [ChildrenChurchService],
  exports: [ChildrenChurchService],
})
export class ChildrenChurchModule {}
