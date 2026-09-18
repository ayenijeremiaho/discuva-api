import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { Page } from './entity/page.entity';
import { TestimonialSubmission } from './entity/testimonial-submission.entity';
import { Form } from '../forms/entity/form.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { PageService } from './service/page.service';
import { GalleryFolderSyncService } from './service/gallery-folder-sync.service';
import { PageAdminController } from './controller/page-admin.controller';
import { PagePublicController } from './controller/page-public.controller';
import { UtilityModule } from '../utility/utility.module';
import { AdminModule } from '../admin/admin.module';
import { ChurchCalendarModule } from '../church-calendar/church-calendar.module';
import { ServiceProgrammeModule } from '../service-programme/service-programme.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    // Form is registered here too (not imported via FormsModule) purely so
    // PageService can look up a REGISTRATION section's formId — no other
    // Forms provider is needed.
    TenantTypeOrmModule.forFeature([Page, Form, TestimonialSubmission]),
    // Tenant is a public-schema, control-plane entity (see UtilityModule's
    // own comment on this) — plain TypeOrmModule.forFeature, not
    // TenantTypeOrmModule. PageService.resolveChurchInfo reads it to back
    // the FOOTER section/automatic footer's church name/address/support
    // email.
    TypeOrmModule.forFeature([Tenant]),
    UtilityModule,
    AdminModule,
    // ChurchCalendarService backs the CHURCH_CALENDAR section type
    // (withChurchCalendarEntries), ServiceSessionService backs LIVE_NOW
    // (withLiveStatus), PlanFeatureResolverService gates CHURCH_CALENDAR
    // behind PlanFeature.CHURCH_CALENDAR — same pattern
    // finance-request.service.ts already uses for a service-level (not
    // controller-guard) plan check.
    ChurchCalendarModule,
    ServiceProgrammeModule,
    BillingModule,
  ],
  providers: [PageService, GalleryFolderSyncService],
  // PagePublicController must come first — PageAdminController's GET
  // /pages/:id is a wildcard that would otherwise swallow PagePublicController's
  // more specific GET /pages/public/:slug first, same route-ordering issue
  // FormsModule's own comment documents.
  controllers: [PagePublicController, PageAdminController],
})
export class PagesModule {}
