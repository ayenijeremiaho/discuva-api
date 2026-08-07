import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { BirthdayWish } from './entity/birthday-wish.entity';
import { BirthdayService } from './service/birthday.service';
import { BirthdayController } from './controller/birthday.controller';
import { MemberModule } from '../member/member.module';
import { AnnouncementModule } from '../announcement/announcement.module';
import { UtilityModule } from '../utility/utility.module';
import { Tenant } from '../tenant/entity/tenant.entity';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([BirthdayWish]),
    // Tenant is public-schema, control-plane — plain TypeOrmModule, needed
    // by BirthdayService.triggerBirthdayGreetings' forEachActiveTenant loop.
    TypeOrmModule.forFeature([Tenant]),
    MemberModule,
    AnnouncementModule,
    UtilityModule,
  ],
  providers: [BirthdayService],
  controllers: [BirthdayController],
})
export class BirthdayModule {}
