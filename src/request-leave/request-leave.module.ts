import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { RequestLeave } from './enitity/request-leave.entity';
import { RequestLeaveService } from './service/request-leave.service';
import { RequestLeaveController } from './controller/request-leave.controller';
import { MemberModule } from '../member/member.module';
import { DepartmentModule } from '../department/department.module';
import { UtilityModule } from '../utility/utility.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([RequestLeave]),
    MemberModule,
    DepartmentModule,
    UtilityModule,
  ],
  controllers: [RequestLeaveController],
  providers: [RequestLeaveService],
  exports: [TenantTypeOrmModule, RequestLeaveService],
})
export class RequestLeaveModule {}
