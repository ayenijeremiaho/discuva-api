import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { DiscuvaAccount } from './entity/discuva-account.entity';
import { DiscuvaAccountLink } from './entity/discuva-account-link.entity';
import { DiscuvaAccountCode } from './entity/discuva-account-code.entity';
import { DiscuvaProfile } from './entity/discuva-profile.entity';
import { DiscuvaMilestone } from './entity/discuva-milestone.entity';
import { DiscuvaPhotoRemoval } from './entity/discuva-photo-removal.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { Member } from '../member/entity/member.entity';
import { MemberSession } from '../member/entity/member-session.entity';
import { Admin } from '../admin/entity/admin.entity';
import { ClassEnrollment } from '../classes/entity/class-enrollment.entity';
import { MemberSessionService } from '../member/service/member-session.service';
import { DiscuvaAccountService } from './service/discuva-account.service';
import { DiscuvaAccountCodeService } from './service/discuva-account-code.service';
import { DiscuvaProfileService } from './service/discuva-profile.service';
import { MilestoneService } from './service/milestone.service';
import { PhotoRemovalService } from './service/photo-removal.service';
import { AccountDataService } from './service/account-data.service';
import { AccountDeletionService } from './service/account-deletion.service';
import { AccountDeletionProcessor } from './processor/account-deletion.processor';
import { ACCOUNT_DELETION_QUEUE } from './processor/account-deletion.queue';
import { BullModule } from '@nestjs/bull';
import { NetworkHome } from './entity/network-home.entity';

// Global so member and auth code can reach it without an import cycle through MemberModule.
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DiscuvaAccount,
      DiscuvaAccountLink,
      DiscuvaAccountCode,
      DiscuvaProfile,
      DiscuvaMilestone,
      DiscuvaPhotoRemoval,
      NetworkHome,
      Tenant,
    ]),
    BullModule.registerQueue({ name: ACCOUNT_DELETION_QUEUE }),
    TenantTypeOrmModule.forFeature([
      Member,
      MemberSession,
      Admin,
      ClassEnrollment,
    ]),
  ],
  providers: [
    DiscuvaAccountService,
    DiscuvaAccountCodeService,
    DiscuvaProfileService,
    MilestoneService,
    PhotoRemovalService,
    AccountDataService,
    AccountDeletionService,
    AccountDeletionProcessor,
    MemberSessionService,
  ],
  exports: [
    DiscuvaAccountService,
    DiscuvaAccountCodeService,
    DiscuvaProfileService,
    MilestoneService,
    PhotoRemovalService,
    AccountDataService,
    AccountDeletionService,
  ],
})
export class DiscuvaAccountModule {}
