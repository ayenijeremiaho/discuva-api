import { Global, Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { Admin } from './entity/admin.entity';
import { AdminRole } from './entity/admin-role.entity';
import { AdminService } from './service/admin.service';
import { AdminRoleService } from './service/admin-role.service';
import { AdminTwoFactorService } from './service/admin-two-factor.service';
import { AdminTwoFactorController } from './controller/admin-two-factor.controller';
import { AdminController } from './controller/admin.controller';
import { AdminRoleController } from './controller/admin-role.controller';
import { AdminGuard } from './guard/admin.guard';
import { DefaultAdminSeed } from './seed/default-admin.seed';
import { MemberModule } from '../member/member.module';
import { UtilityModule } from '../utility/utility.module';

@Global()
@Module({
  imports: [
    TenantTypeOrmModule.forFeature([Admin, AdminRole]),
    MemberModule,
    UtilityModule,
  ],
  controllers: [AdminTwoFactorController, AdminController, AdminRoleController],
  providers: [
    AdminService,
    AdminRoleService,
    AdminTwoFactorService,
    AdminGuard,
    DefaultAdminSeed,
  ],
  exports: [
    AdminService,
    AdminRoleService,
    AdminTwoFactorService,
    AdminGuard,
    TenantTypeOrmModule,
  ],
})
export class AdminModule {}
