import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { ServiceProgramme } from './entity/service-programme.entity';
import { ServiceProgrammeSlot } from './entity/service-programme-slot.entity';
import { ServiceSession } from './entity/service-session.entity';
import { ServiceSessionSlot } from './entity/service-session-slot.entity';
import { ServicePauseEntry } from './entity/service-pause-entry.entity';
import { ServiceActionEntry } from './entity/service-action-entry.entity';
import { ServiceSessionAccessGrant } from './entity/service-session-access-grant.entity';
import { ServiceProgrammeTemplate } from './entity/service-programme-template.entity';
import { ServiceSlot } from '../event/entity/service-slot.entity';
import { Member } from '../member/entity/member.entity';
import { WorkerProfile } from '../member/entity/worker-profile.entity';
import { ServiceProgrammeService } from './service/service-programme.service';
import { ServiceSessionService } from './service/service-session.service';
import { ServiceProgrammeController } from './controller/service-programme.controller';
import { ServiceSessionController } from './controller/service-session.controller';
import { ServiceSessionGateway } from './gateway/service-session.gateway';
import { ShareTokenGuard } from './guard/share-token.guard';
import { NamedAccessGuard } from './guard/named-access.guard';
import { ServiceProgrammeReminderScheduler } from './scheduler/service-programme-reminder.scheduler';
import { ProgrammeAutoStartScheduler } from './scheduler/programme-auto-start.scheduler';
import { UtilityModule } from '../utility/utility.module';
import { DepartmentModule } from '../department/department.module';
import { Tenant } from '../tenant/entity/tenant.entity';
import jwtConfig from '../config/jwt.config';
import refreshJwtConfig from '../config/refresh.jwt.config';

@Module({
  imports: [
    // Independent registration from AuthModule's own (same jwtConfig/
    // refreshJwtConfig factories, same secrets) — ServiceSessionGateway
    // verifies a JWT's tenant claim itself in handleConnection, the same
    // "any module can independently register the same JwtModule config"
    // pattern TenantMiddleware uses.
    JwtModule.registerAsync(jwtConfig.asProvider()),
    ConfigModule.forFeature(refreshJwtConfig),
    TenantTypeOrmModule.forFeature([
      ServiceProgramme,
      ServiceProgrammeSlot,
      ServiceSession,
      ServiceSessionSlot,
      ServicePauseEntry,
      ServiceActionEntry,
      ServiceSessionAccessGrant,
      ServiceProgrammeTemplate,
      ServiceSlot,
      Member,
      WorkerProfile,
    ]),
    // Tenant is public-schema, control-plane — plain TypeOrmModule, needed
    // by ServiceProgrammeReminderScheduler's forEachActiveTenant loop.
    TypeOrmModule.forFeature([Tenant]),
    UtilityModule,
    DepartmentModule,
  ],
  controllers: [ServiceProgrammeController, ServiceSessionController],
  providers: [
    ServiceProgrammeService,
    ServiceSessionService,
    ServiceSessionGateway,
    ShareTokenGuard,
    NamedAccessGuard,
    ServiceProgrammeReminderScheduler,
    ProgrammeAutoStartScheduler,
  ],
  exports: [ServiceProgrammeService, ServiceSessionService],
})
export class ServiceProgrammeModule {}
