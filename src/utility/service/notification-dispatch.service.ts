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
  // Lets a Push-first category skip this email when the same member is getting the push.
  recipientMemberId?: string;
  // Same, for a multi-address `to`: one member id per address, in the same order.
  recipientMemberIds?: string[];
}

export interface NotifyMemberPush extends CataloguePush {
  memberIds: string[];
}

// Sends the email and push for one event. Each leg has its own per-church switch for the category:
// email checks EmailCategorySettingsService.isEnabled here (and Push first), push is gated inside PushNotificationService.
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
    const email =
      opts.email &&
      (await this.emailCategorySettingsService.isEnabled(opts.category))
        ? await this.withoutPushCovered(opts.category, opts.email, opts.push)
        : null;
    if (email) {
      const { to, subject, template, data, attachments } = email;
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

  // Push first: an address is dropped only when this same notification reaches its member by push.
  private async withoutPushCovered(
    category: EmailCategory,
    email: NotifyMemberEmail,
    push?: NotifyMemberPush,
  ): Promise<NotifyMemberEmail | null> {
    const addresses = Array.isArray(email.to) ? email.to : [email.to];
    const ids =
      email.recipientMemberIds ??
      (email.recipientMemberId ? [email.recipientMemberId] : []);
    if (!push || ids.length !== addresses.length) return email;

    const pushed = new Set(push.memberIds);
    const candidates = ids.filter((id) => pushed.has(id));
    if (!candidates.length) return email;
    if (!(await this.emailCategorySettingsService.isPushFirst(category))) {
      return email;
    }
    const subscribed =
      await this.pushNotificationService.membersWithSubscription(candidates);
    const remaining = addresses.filter(
      (_, i) => !(pushed.has(ids[i]) && subscribed.has(ids[i])),
    );
    if (!remaining.length) return null;
    if (remaining.length === addresses.length) return email;
    return {
      ...email,
      to: Array.isArray(email.to) ? remaining : remaining[0],
    };
  }
}
