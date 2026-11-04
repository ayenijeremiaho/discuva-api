import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProtectedName } from './protected-name.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { ProtectedNameService } from './protected-name.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ProtectedName, Tenant])],
  providers: [ProtectedNameService],
  exports: [ProtectedNameService],
})
export class ProtectedNameModule {}
