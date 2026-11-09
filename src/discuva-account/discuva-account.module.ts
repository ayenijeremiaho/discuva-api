import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { DiscuvaAccount } from './entity/discuva-account.entity';
import { DiscuvaAccountLink } from './entity/discuva-account-link.entity';
import { DiscuvaAccountCode } from './entity/discuva-account-code.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { Member } from '../member/entity/member.entity';
import { MemberSession } from '../member/entity/member-session.entity';
import { Admin } from '../admin/entity/admin.entity';
import { MemberSessionService } from '../member/service/member-session.service';
import { DiscuvaAccountService } from './service/discuva-account.service';
import { DiscuvaAccountCodeService } from './service/discuva-account-code.service';

// Global so member and auth code can reach it without an import cycle through MemberModule.
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DiscuvaAccount,
      DiscuvaAccountLink,
      DiscuvaAccountCode,
      Tenant,
    ]),
    TenantTypeOrmModule.forFeature([Member, MemberSession, Admin]),
  ],
  providers: [
    DiscuvaAccountService,
    DiscuvaAccountCodeService,
    MemberSessionService,
  ],
  exports: [DiscuvaAccountService, DiscuvaAccountCodeService],
})
export class DiscuvaAccountModule {}
