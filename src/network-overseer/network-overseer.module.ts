import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { Tenant } from '../tenant/entity/tenant.entity';
import jwtConfig from '../config/jwt.config';
import { NetworkOverseer } from './network-overseer.entity';
import { OverseerAccessService } from './overseer-access.service';

// Global so the admin guard and the token check can recognise an overseer's pass in every module.
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([NetworkOverseer, Tenant]),
    JwtModule.registerAsync(jwtConfig.asProvider()),
  ],
  providers: [OverseerAccessService],
  exports: [OverseerAccessService, TypeOrmModule],
})
export class NetworkOverseerModule {}
