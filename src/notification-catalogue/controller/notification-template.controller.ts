import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { PlanGuard } from '../../billing/guard/plan.guard';
import { RequiresPlan } from '../../billing/decorator/requires-plan.decorator';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';
import { NotificationTemplateService } from '../service/notification-template.service';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';
import {
  DraftEmailWordingDto,
  EmailWordingDto,
  TestPushTemplateDto,
  UpdatePushTemplateDto,
} from '../dto/push-template.dto';
import { PushNotificationKey, renderPush } from '../push-catalogue';
import {
  EmailTemplateKey,
  EmailWording,
  renderCatalogueEmail,
} from '../email-catalogue';
import { EmailQueueService } from '../../utility/service/email-queue.service';
import { SanitizationService } from '../../utility/service/sanitization.service';

@UseGuards(AdminGuard, PlanGuard)
@Controller('admin/notification-templates')
export class NotificationTemplateController {
  constructor(
    private readonly templates: NotificationTemplateService,
    private readonly pushService: PushNotificationService,
    private readonly emailQueue: EmailQueueService,
    private readonly sanitization: SanitizationService,
  ) {}

  private readonly sanitizeHtml = (html: string) =>
    this.sanitization.sanitizeForEmail(html);

  // Readable on every plan so churches see the defaults; changes need the plan feature.
  @RequiresPermission(AdminPermission.ADMIN_READ)
  @Get('push')
  listPush() {
    return this.templates.listPush();
  }

  @RequiresPermission(AdminPermission.ADMIN_WRITE)
  @RequiresPlan(PlanFeature.NOTIFICATION_CUSTOMIZATION)
  @Put('push/:key')
  savePush(
    @Param('key') key: string,
    @Body() dto: UpdatePushTemplateDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.templates.savePush(key, dto, admin.member?.id);
  }

  @RequiresPermission(AdminPermission.ADMIN_WRITE)
  @RequiresPlan(PlanFeature.NOTIFICATION_CUSTOMIZATION)
  @Delete('push/:key')
  resetPush(@Param('key') key: string, @CurrentAdmin() admin: Admin) {
    return this.templates.resetPush(key, admin.member?.id);
  }

  // Sends the draft (or saved) wording, filled with sample values, to the admin's own device.
  @RequiresPermission(AdminPermission.ADMIN_WRITE)
  @RequiresPlan(PlanFeature.NOTIFICATION_CUSTOMIZATION)
  @HttpCode(HttpStatus.OK)
  @Post('push/:key/test')
  async testPush(
    @Param('key') key: string,
    @Body() dto: TestPushTemplateDto,
    @CurrentAdmin() admin: Admin,
  ): Promise<{ sent: boolean; reason?: 'NO_DEVICE' }> {
    const template = this.templates.assertPushKey(key);
    const memberId = admin.member?.id;
    if (!memberId || !(await this.pushService.hasSubscription(memberId))) {
      return { sent: false, reason: 'NO_DEVICE' };
    }
    const current = await this.templates.resolvePushTemplate(
      key as PushNotificationKey,
    );
    const rendered = renderPush(
      { title: dto.title || current.title, body: dto.body || current.body },
      template.placeholders,
    );
    await this.pushService.dispatchToMemberIds([memberId], {
      ...rendered,
      url: template.url,
      idempotencyKey: `template-test:${key}:${Date.now()}`,
    });
    return { sent: true };
  }

  @RequiresPermission(AdminPermission.ADMIN_READ)
  @Get('email')
  listEmail() {
    return this.templates.listEmail();
  }

  @RequiresPermission(AdminPermission.ADMIN_WRITE)
  @RequiresPlan(PlanFeature.NOTIFICATION_CUSTOMIZATION)
  @Put('email/:key')
  saveEmail(
    @Param('key') key: string,
    @Body() dto: EmailWordingDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.templates.saveEmail(
      key,
      dto,
      this.sanitizeHtml,
      admin.member?.id,
    );
  }

  @RequiresPermission(AdminPermission.ADMIN_WRITE)
  @RequiresPlan(PlanFeature.NOTIFICATION_CUSTOMIZATION)
  @Delete('email/:key')
  resetEmail(@Param('key') key: string, @CurrentAdmin() admin: Admin) {
    return this.templates.resetEmail(key, admin.member?.id);
  }

  // Whole email as members would get it, with sample details; body is an optional unsaved draft.
  @RequiresPermission(AdminPermission.ADMIN_READ)
  @HttpCode(HttpStatus.OK)
  @Post('email/:key/preview')
  previewEmail(@Param('key') key: string, @Body() dto: DraftEmailWordingDto) {
    return this.renderSample(key, dto);
  }

  @RequiresPermission(AdminPermission.ADMIN_WRITE)
  @RequiresPlan(PlanFeature.NOTIFICATION_CUSTOMIZATION)
  @HttpCode(HttpStatus.OK)
  @Post('email/:key/test')
  async testEmail(
    @Param('key') key: string,
    @Body() dto: DraftEmailWordingDto,
    @CurrentAdmin() admin: Admin,
  ): Promise<{ sent: boolean; to: string }> {
    const to = admin.member?.email;
    const { subject, html } = await this.renderSample(key, dto);
    await this.emailQueue.queueEmail(to, `[Test] ${subject}`, html);
    return { sent: true, to };
  }

  private async renderSample(key: string, draft: DraftEmailWordingDto) {
    const template = this.templates.assertEmailKey(key);
    const saved = await this.templates.resolveEmailWording(
      key as EmailTemplateKey,
    );
    const hasDraft = Object.values(draft ?? {}).some((v) => v !== undefined);
    const wording: EmailWording = hasDraft
      ? this.templates.validateEmailWording(
          { ...saved, ...draft } as EmailWordingDto,
          template,
          this.sanitizeHtml,
        )
      : saved;
    const branding = await this.emailQueue.getBrandingData();
    return renderCatalogueEmail(
      key as EmailTemplateKey,
      wording,
      template.sampleData,
      branding,
    );
  }
}
