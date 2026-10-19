import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { Member } from '../../member/entity/member.entity';
import { ChurchSettingsService } from '../../church-settings/service/church-settings.service';
import { EmailCategorySettingsService } from '../../email-category-settings/service/email-category-settings.service';
import { PlanFeatureResolverService } from '../../billing/service/plan-feature-resolver.service';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import {
  MEMBER_NOTIFICATION_CHOICES,
  MemberNotificationChoice,
} from '../constant/member-notification-choices.constant';
import { UpdateNotificationPreferenceDto } from '../dto/update-notification-preference.dto';

export interface NotificationPreference {
  category: string;
  label: string;
  description: string;
  enabled: boolean;
}

@Injectable()
export class NotificationPreferencesService {
  constructor(
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    private readonly churchSettings: ChurchSettingsService,
    private readonly categorySettings: EmailCategorySettingsService,
    private readonly planFeatures: PlanFeatureResolverService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  // Only kinds this church actually sends: module on, and email or push left on for the category.
  async list(memberId: string): Promise<NotificationPreference[]> {
    const member = await this.memberRepo.findOne({
      where: { id: memberId },
      select: { id: true, mutedNotifications: true },
    });
    if (!member) throw new NotFoundException('Member not found');
    const muted = new Set(member.mutedNotifications ?? []);
    const offered = await Promise.all(
      MEMBER_NOTIFICATION_CHOICES.map((c) => this.isOffered(c)),
    );
    return MEMBER_NOTIFICATION_CHOICES.filter((_, i) => offered[i]).map(
      ({ category, label, description }) => ({
        category,
        label,
        description,
        enabled: !muted.has(category),
      }),
    );
  }

  async update(
    memberId: string,
    { category, enabled }: UpdateNotificationPreferenceDto,
  ): Promise<NotificationPreference[]> {
    // One statement, so two quick taps on different switches can't overwrite each other.
    await this.memberRepo
      .createQueryBuilder()
      .update(Member)
      .set({
        mutedNotifications: () =>
          enabled
            ? 'array_remove(muted_notifications, :category)'
            : 'array_append(array_remove(muted_notifications, :category), :category)',
      })
      .where('id = :memberId', { memberId })
      .setParameter('category', category)
      .execute();
    return this.list(memberId);
  }

  private async isOffered(choice: MemberNotificationChoice): Promise<boolean> {
    if (choice.module) {
      if (!(await this.churchSettings.isEnabled(choice.module))) return false;
      const tenantId = this.cls.get('tenantId');
      if (
        tenantId &&
        (await this.planFeatures.gateReason(tenantId, choice.module))
      )
        return false;
    }
    const [email, push] = await Promise.all([
      this.categorySettings.isEnabled(choice.category),
      this.categorySettings.isPushEnabled(choice.category),
    ]);
    return email || push;
  }
}
