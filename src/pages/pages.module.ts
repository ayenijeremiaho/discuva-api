import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { Page } from './entity/page.entity';
import { Form } from '../forms/entity/form.entity';
import { PageService } from './service/page.service';
import { PageAdminController } from './controller/page-admin.controller';
import { PagePublicController } from './controller/page-public.controller';
import { UtilityModule } from '../utility/utility.module';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [
    // Form is registered here too (not imported via FormsModule) purely so
    // PageService can look up a REGISTRATION section's formId — no other
    // Forms provider is needed.
    TenantTypeOrmModule.forFeature([Page, Form]),
    UtilityModule,
    AdminModule,
  ],
  providers: [PageService],
  // PagePublicController must come first — PageAdminController's GET
  // /pages/:id is a wildcard that would otherwise swallow PagePublicController's
  // more specific GET /pages/public/:slug first, same route-ordering issue
  // FormsModule's own comment documents.
  controllers: [PagePublicController, PageAdminController],
})
export class PagesModule {}
