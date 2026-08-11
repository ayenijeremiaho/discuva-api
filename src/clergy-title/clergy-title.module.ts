import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { ClergyTitle } from './entity/clergy-title.entity';
import { Clergy } from '../member/entity/clergy.entity';
import { ClergyTitleService } from './service/clergy-title.service';
import { ClergyTitleController } from './controller/clergy-title.controller';
import { UtilityModule } from '../utility/utility.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([ClergyTitle, Clergy]),
    UtilityModule,
  ],
  controllers: [ClergyTitleController],
  providers: [ClergyTitleService],
  exports: [TenantTypeOrmModule, ClergyTitleService],
})
export class ClergyTitleModule {}
