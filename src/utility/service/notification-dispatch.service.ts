import { Injectable } from '@nestjs/common';
import { EmailQueueService } from './email-queue.service';
import { EmailCategorySettingsService } from '../../email-category-settings/service/email-category-settings.service';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';
import { EmailCategory } from '../email-provider/email-category.enum';
import { CataloguePush } from '../../push-notification/dto/push-notification.dto';

export interface NotifyMemberEmail {
  to: string | string[];
  subject: string;
  template: string;
  data: Record<string, unknown>;
  attachments?: Array<{ filename: string; content: Buffer }>;
}

export interface NotifyMemberPush extends CataloguePush {
  memberIds: string[];
}

// Sends the email and push for one event. Each leg has its own per-church switch for the category:
// email checks EmailCategorySettingsService.isEnabled here, push is gated inside PushNotificationService.
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
    if (
      opts.email &&
      (await this.emailCategorySettingsService.isEnabled(opts.category))
    ) {
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
      const { memberIds, ...push } = opts.push;
      this.pushNotificationService.dispatchToMemberIds(memberIds, push);
    }
  }
}
