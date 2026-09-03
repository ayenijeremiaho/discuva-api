import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { Form } from './entity/form.entity';
import { FormField } from './entity/form-field.entity';
import { FormSubmission } from './entity/form-submission.entity';
import { FormFieldAttachment } from './entity/form-field-attachment.entity';
import { Member } from '../member/entity/member.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { FormService } from './service/form.service';
import { FormSubmissionService } from './service/form-submission.service';
import { FormAttachmentCleanupScheduler } from './scheduler/form-attachment-cleanup.scheduler';
import { FormAdminController } from './controller/form-admin.controller';
import { FormMemberController } from './controller/form-member.controller';
import { FormPublicController } from './controller/form-public.controller';
import { FollowUpModule } from '../follow-up/follow-up.module';
import { GroupModule } from '../group/group.module';
import { UtilityModule } from '../utility/utility.module';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      Form,
      FormField,
      FormSubmission,
      FormFieldAttachment,
      Member,
    ]),
    // Tenant is public-schema, control-plane — plain TypeOrmModule, needed
    // by FormAttachmentCleanupScheduler's forEachActiveTenant loop.
    TypeOrmModule.forFeature([Tenant]),
    FollowUpModule,
    GroupModule,
    UtilityModule,
    AdminModule,
  ],
  providers: [
    FormService,
    FormSubmissionService,
    FormAttachmentCleanupScheduler,
  ],
  // Order matters: Nest/Express matches routes in registration order, and
  // FormAdminController's GET /forms/:id is a wildcard that would otherwise
  // swallow FormMemberController's more specific GET /forms/member and
  // FormPublicController's GET /forms/public/:id before they're ever
  // reached — confirmed empirically (a member token hit AdminGuard's 403
  // instead of FormMemberController). The specific-path controllers must
  // come first.
  controllers: [
    FormMemberController,
    FormPublicController,
    FormAdminController,
  ],
})
export class FormsModule {}
