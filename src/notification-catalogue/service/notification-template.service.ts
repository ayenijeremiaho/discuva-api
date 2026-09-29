import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import {
  NotificationChannel,
  NotificationTemplateOverride,
} from '../entity/notification-template-override.entity';
import {
  PUSH_CATALOGUE,
  PushNotificationKey,
  PushTemplate,
} from '../push-catalogue';
import {
  PushTemplateView,
  UpdatePushTemplateDto,
} from '../dto/push-template.dto';
import { KNOWN_EMAIL_CATEGORIES } from '../../email-category-settings/constant/known-email-categories.constant';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { PlanFeatureResolverService } from '../../billing/service/plan-feature-resolver.service';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';

type PushOverrides = Record<
  string,
  { title: string | null; body: string | null; updatedAt: string }
>;

const PUSH_CACHE_KEY = 'notification-overrides:push';
const CACHE_TTL = 300;
const PLACEHOLDER = /{{\s*(\w+)\s*}}/g;

// Push is plain text: drop markup and line breaks, collapse spacing.
function toPlainText(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

@Injectable()
export class NotificationTemplateService {
  constructor(
    @InjectRepository(NotificationTemplateOverride)
    private readonly overrideRepo: Repository<NotificationTemplateOverride>,
    private readonly cacheService: CacheService,
    private readonly auditLogService: AuditLogService,
    private readonly planFeatureResolver: PlanFeatureResolverService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async isCustomizationAvailable(): Promise<boolean> {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) return false;
    const { features } = await this.planFeatureResolver.resolve(tenantId);
    return features.includes(PlanFeature.NOTIFICATION_CUSTOMIZATION);
  }

  private async pushOverrides(): Promise<PushOverrides> {
    const cached = await this.cacheService.get<PushOverrides>(PUSH_CACHE_KEY);
    if (cached) return cached;
    const rows = await this.overrideRepo.find({
      where: { channel: NotificationChannel.PUSH },
    });
    const map: PushOverrides = {};
    for (const row of rows) {
      map[row.templateKey] = {
        title: row.title,
        body: row.body,
        updatedAt: row.updatedAt?.toISOString?.() ?? String(row.updatedAt),
      };
    }
    this.cacheService.set(PUSH_CACHE_KEY, map, CACHE_TTL);
    return map;
  }

  // Wording to send: the church's override while its plan includes customization, else the default.
  async resolvePushTemplate(key: PushNotificationKey): Promise<PushTemplate> {
    const template = PUSH_CATALOGUE[key];
    const override = (await this.pushOverrides())[key];
    if (!override || !(await this.isCustomizationAvailable())) return template;
    return {
      ...template,
      title: override.title || template.title,
      body: override.body || template.body,
    };
  }

  async listPush(): Promise<{
    customizationAvailable: boolean;
    items: PushTemplateView[];
  }> {
    const [overrides, customizationAvailable] = await Promise.all([
      this.pushOverrides(),
      this.isCustomizationAvailable(),
    ]);
    const items = (Object.keys(PUSH_CATALOGUE) as PushNotificationKey[]).map(
      (key) => this.toView(key, overrides[key]),
    );
    return { customizationAvailable, items };
  }

  async savePush(
    key: string,
    dto: UpdatePushTemplateDto,
    actorMemberId?: string,
  ): Promise<PushTemplateView> {
    const template = this.assertPushKey(key);
    const title = this.validate(dto.title, template, 'Title');
    const body = this.validate(dto.body, template, 'Message');

    let row = await this.overrideRepo.findOne({
      where: { channel: NotificationChannel.PUSH, templateKey: key },
    });
    row ??= this.overrideRepo.create({
      channel: NotificationChannel.PUSH,
      templateKey: key,
    });
    row.title = title === template.title ? null : title;
    row.body = body === template.body ? null : body;
    row.updatedBy = actorMemberId ? ({ id: actorMemberId } as never) : null;

    if (!row.title && !row.body) {
      if (row.id) await this.overrideRepo.delete({ id: row.id });
    } else {
      row = await this.overrideRepo.save(row);
    }
    this.cacheService.del(PUSH_CACHE_KEY);
    this.auditLogService.log('NOTIFICATION_TEMPLATE_UPDATED', {
      actorId: actorMemberId,
      targetId: key,
      metadata: { channel: NotificationChannel.PUSH, title, body },
    });

    const saved =
      row.title || row.body
        ? {
            title: row.title,
            body: row.body,
            updatedAt: new Date().toISOString(),
          }
        : undefined;
    return this.toView(key as PushNotificationKey, saved);
  }

  async resetPush(
    key: string,
    actorMemberId?: string,
  ): Promise<PushTemplateView> {
    this.assertPushKey(key);
    await this.overrideRepo.delete({
      channel: NotificationChannel.PUSH,
      templateKey: key,
    });
    this.cacheService.del(PUSH_CACHE_KEY);
    this.auditLogService.log('NOTIFICATION_TEMPLATE_RESET', {
      actorId: actorMemberId,
      targetId: key,
      metadata: { channel: NotificationChannel.PUSH },
    });
    return this.toView(key as PushNotificationKey, undefined);
  }

  assertPushKey(key: string): PushTemplate {
    const template = PUSH_CATALOGUE[key as PushNotificationKey];
    if (!template) throw new NotFoundException(`Unknown notification: ${key}`);
    return template;
  }

  private validate(raw: string, template: PushTemplate, field: string): string {
    const text = toPlainText(raw);
    if (!text) throw new BadRequestException(`${field} can't be empty.`);
    const unknown = [...text.matchAll(PLACEHOLDER)]
      .map((m) => m[1])
      .filter((name) => !(name in template.placeholders));
    if (unknown.length) {
      const allowed = Object.keys(template.placeholders);
      throw new BadRequestException(
        `${field} uses ${[...new Set(unknown)].map((n) => `{{${n}}}`).join(', ')}, which this notification doesn't have.` +
          (allowed.length
            ? ` Available: ${allowed.map((n) => `{{${n}}}`).join(', ')}.`
            : ' It has no placeholders.'),
      );
    }
    return text;
  }

  private toView(
    key: PushNotificationKey,
    override?: { title: string | null; body: string | null; updatedAt: string },
  ): PushTemplateView {
    const template = PUSH_CATALOGUE[key];
    return {
      key,
      category: template.category,
      categoryLabel: KNOWN_EMAIL_CATEGORIES[template.category].label,
      label: template.label,
      description: template.description,
      placeholders: template.placeholders,
      defaultTitle: template.title,
      defaultBody: template.body,
      title: override?.title || template.title,
      body: override?.body || template.body,
      customized: !!(override?.title || override?.body),
      updatedAt: override ? new Date(override.updatedAt) : null,
    };
  }
}
