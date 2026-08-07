import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { AuthService } from './service/auth.service';
import { AuthController } from './controller/auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './guard/jwt-auth.guard';
import { PasswordChangeRequiredGuard } from './guard/password-change-required.guard';
import { JwtStrategy } from './strategy/jwt.strategy';
import { RefreshJwtStrategy } from './strategy/refresh.jwt.strategy';
import { LocalStrategy } from './strategy/local.strategy';
import { PasswordResetOtp } from './entity/password-reset-otp.entity';
import { DeviceResetOtp } from './entity/device-reset-otp.entity';
import { EmailChangeOtp } from './entity/email-change-otp.entity';
import { DepartmentLead } from '../department/entity/department-lead.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import jwtConfig from '../config/jwt.config';
import refreshJwtConfig from '../config/refresh.jwt.config';
import { MemberModule } from '../member/member.module';
import { UtilityModule } from '../utility/utility.module';

@Module({
  imports: [
    MemberModule,
    UtilityModule,
    TenantTypeOrmModule.forFeature([
      PasswordResetOtp,
      DeviceResetOtp,
      EmailChangeOtp,
      DepartmentLead,
    ]),
    // Tenant is public-schema, control-plane — plain TypeOrmModule, needed
    // by AuthService.purgeExpiredOtps' forEachActiveTenant loop.
    TypeOrmModule.forFeature([Tenant]),
    JwtModule.registerAsync(jwtConfig.asProvider()),
    ConfigModule.forFeature(jwtConfig),
    ConfigModule.forFeature(refreshJwtConfig),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LocalStrategy,
    JwtStrategy,
    RefreshJwtStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PasswordChangeRequiredGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
