import { Injectable } from '@nestjs/common';
import { EmailQueueService } from './email-queue.service';
import { EmailCategorySettingsService } from '../../email-category-settings/service/email-category-settings.service';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';
import { EmailCategory } from '../email-provider/email-category.enum';

export interface NotifyMemberEmail {
  to: string | string[];
  subject: string;
  template: string;
  data: Record<string, unknown>;
  attachments?: Array<{ filename: string; content: Buffer }>;
}

export interface NotifyMemberPush {
  memberIds: string[];
  title: string;
  body: string;
  url: string;
  // Passed straight through to PushNotificationService.dispatchToMemberIds,
  // which builds the per-subscription queue jobId from it — same
  // idempotency contract, just documented here so callers don't have to
  // read that service to know it needs to be unique per notification
  // *event*, not per member (memberId is already folded in downstream).
  idempotencyKey: string;
}

// Fires the email and push legs of one notification together, gated by the
// SAME per-tenant EmailCategory preference (EmailCategorySettingsService) —
// before this existed, several call sites (service-programme assignment,
// event reminders) queued email through that gate but dispatched push
// completely unconditionally, so an admin disabling a category's emails
// left push still firing for the exact same event. Named
// EmailCategorySettingsService for historical reasons (it predates push),
// but it already models "is this category of notification on for this
// church" independent of channel — reused as-is rather than introducing a
// second, parallel preference store.
//
// Either leg is optional so a caller can send email-only, push-only, or
// both — but the category gate applies to both uniformly; there's no
// per-channel opt-out below the category level.
@Injectable()
export class NotificationDispatchService {
  constructor(
    private readonly emailQueueService: EmailQueueService,
    private readonly pushNotificationService: PushNotificationService,
    private readonly emailCategorySettingsService: EmailCategorySettingsService,
  ) {}

  async notifyMember(opts: {
    category: EmailCategory;
    email?: NotifyMemberEmail;
    push?: NotifyMemberPush;
  }): Promise<void> {
    if (!(await this.emailCategorySettingsService.isEnabled(opts.category))) {
      return;
    }

    if (opts.email) {
      const { to, subject, template, data, attachments } = opts.email;
      if (attachments) {
        this.emailQueueService.queueEmailWithTemplateAndAttachments(
          to,
          subject,
          template,
          data,
          attachments,
          undefined,
          opts.category,
        );
      } else {
        this.emailQueueService.queueEmailWithTemplate(
          to,
          subject,
          template,
          data,
          undefined,
          opts.category,
        );
      }
    }

    if (opts.push) {
      const { memberIds, title, body, url, idempotencyKey } = opts.push;
      this.pushNotificationService.dispatchToMemberIds(memberIds, {
        idempotencyKey,
        title,
        body,
        url,
      });
    }
  }
}
