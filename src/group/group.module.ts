import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Group } from './entity/group.entity';
import { GroupMember } from './entity/group-member.entity';
import { FirstTimer } from '../follow-up/entity/first-timer.entity';
import { GroupService } from './service/group.service';
import { GroupController } from './controller/group.controller';
import { UtilityModule } from '../utility/utility.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Group, GroupMember, FirstTimer]),
    UtilityModule,
  ],
  providers: [GroupService],
  controllers: [GroupController],
  exports: [TypeOrmModule, GroupService],
})
export class GroupModule {}
