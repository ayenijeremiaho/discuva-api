import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { MemberDirectoryProfile } from './entity/member-directory-profile.entity';
import { MemberDirectoryService } from './service/member-directory.service';
import { MemberDirectoryController } from './controller/member-directory.controller';
import { MemberDirectoryAdminController } from './controller/member-directory-admin.controller';
import { MemberModule } from '../member/member.module';
import { UtilityModule } from '../utility/utility.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([MemberDirectoryProfile]),
    MemberModule,
    UtilityModule,
  ],
  providers: [MemberDirectoryService],
  controllers: [MemberDirectoryController, MemberDirectoryAdminController],
})
export class MemberDirectoryModule {}
