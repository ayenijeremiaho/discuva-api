import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { BuilderTemplate } from './entity/builder-template.entity';
import { BuilderTemplateService } from './service/builder-template.service';

@Module({
  imports: [TenantTypeOrmModule.forFeature([BuilderTemplate])],
  providers: [BuilderTemplateService],
  exports: [BuilderTemplateService],
})
export class BuilderTemplateModule {}
