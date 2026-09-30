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
  NotificationTemplateAction,
  NotificationTemplateVersion,
} from '../entity/notification-template-version.entity';
import {
  PUSH_CATALOGUE,
  PushNotificationKey,
  PushTemplate,
} from '../push-catalogue';
import {
  EmailTemplateView,
  EmailWordingDto,
  NotificationTemplateVersionView,
  PushTemplateView,
  UpdatePushTemplateDto,
} from '../dto/push-template.dto';
import {
  EMAIL_CATALOGUE,
  EmailTemplate,
  EmailWording,
  RICH_EMAIL_FIELDS,
  defaultWording,
  isCatalogueEmail,
} from '../email-catalogue';
import { RECIPIENT_PLACEHOLDERS } from '../recipient';
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
const EMAIL_CACHE_KEY = 'notification-overrides:email';
const EMAIL_FIELDS: (keyof EmailWording)[] = [
  'subject',
  'heading',
  'message',
  'closing',
  'signoff',
  'signature',
];
const EMAIL_FIELD_LABELS: Record<keyof EmailWording, string> = {
  subject: 'Subject',
  heading: 'Heading',
  message: 'Message',
  closing: 'Closing message',
  signoff: 'Sign-off',
  signature: 'Signature',
};

type EmailOverrides = Record<
  string,
  { content: Partial<EmailWording>; updatedAt: string }
>;
const CACHE_TTL = 300;
const HISTORY_LIMIT = 20;
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
    @InjectRepository(NotificationTemplateVersion)
    private readonly versionRepo: Repository<NotificationTemplateVersion>,
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
    action = NotificationTemplateAction.SAVED,
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
    await this.recordVersion(
      NotificationChannel.PUSH,
      key,
      action,
      { title, body },
      actorMemberId,
    );
    this.auditLogService.log('NOTIFICATION_TEMPLATE_UPDATED', {
      actorId: actorMemberId,
      targetId: key,
      metadata: { channel: NotificationChannel.PUSH, action, title, body },
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
    const template = this.assertPushKey(key);
    await this.overrideRepo.delete({
      channel: NotificationChannel.PUSH,
      templateKey: key,
    });
    this.cacheService.del(PUSH_CACHE_KEY);
    await this.recordVersion(
      NotificationChannel.PUSH,
      key,
      NotificationTemplateAction.RESET,
      { title: template.title, body: template.body },
      actorMemberId,
    );
    this.auditLogService.log('NOTIFICATION_TEMPLATE_RESET', {
      actorId: actorMemberId,
      targetId: key,
      metadata: { channel: NotificationChannel.PUSH },
    });
    return this.toView(key as PushNotificationKey, undefined);
  }

  private async emailOverrides(): Promise<EmailOverrides> {
    const cached = await this.cacheService.get<EmailOverrides>(EMAIL_CACHE_KEY);
    if (cached) return cached;
    const rows = await this.overrideRepo.find({
      where: { channel: NotificationChannel.EMAIL },
    });
    const map: EmailOverrides = {};
    for (const row of rows) {
      map[row.templateKey] = {
        content: (row.content ?? {}) as Partial<EmailWording>,
        updatedAt: row.updatedAt?.toISOString?.() ?? String(row.updatedAt),
      };
    }
    this.cacheService.set(EMAIL_CACHE_KEY, map, CACHE_TTL);
    return map;
  }

  // Wording to send: church edits (while the plan includes customization) over the defaults, field by field.
  async resolveEmailWording(key: string): Promise<EmailWording> {
    const defaults = defaultWording(key);
    const override = (await this.emailOverrides())[key];
    if (!override || !(await this.isCustomizationAvailable())) return defaults;
    return { ...defaults, ...override.content };
  }

  async listEmail(): Promise<{
    customizationAvailable: boolean;
    items: EmailTemplateView[];
  }> {
    const [overrides, customizationAvailable] = await Promise.all([
      this.emailOverrides(),
      this.isCustomizationAvailable(),
    ]);
    const items = Object.keys(EMAIL_CATALOGUE).map((key) =>
      this.toEmailView(key, overrides[key]),
    );
    return { customizationAvailable, items };
  }

  async saveEmail(
    key: string,
    dto: EmailWordingDto,
    sanitizeHtml: (html: string) => string,
    actorMemberId?: string,
    action = NotificationTemplateAction.SAVED,
  ): Promise<EmailTemplateView> {
    const template = this.assertEmailKey(key);
    const wording = this.validateEmailWording(dto, template, sanitizeHtml);
    const defaults = defaultWording(key);
    const changed: Partial<EmailWording> = {};
    for (const field of EMAIL_FIELDS) {
      if (wording[field] !== defaults[field]) changed[field] = wording[field];
    }

    const existing = await this.overrideRepo.findOne({
      where: { channel: NotificationChannel.EMAIL, templateKey: key },
    });
    if (!Object.keys(changed).length) {
      if (existing) await this.overrideRepo.delete({ id: existing.id });
    } else {
      const row =
        existing ??
        this.overrideRepo.create({
          channel: NotificationChannel.EMAIL,
          templateKey: key,
        });
      row.content = changed as Record<string, string>;
      row.updatedBy = actorMemberId ? ({ id: actorMemberId } as never) : null;
      await this.overrideRepo.save(row);
    }
    this.cacheService.del(EMAIL_CACHE_KEY);
    await this.recordVersion(
      NotificationChannel.EMAIL,
      key,
      action,
      { ...wording },
      actorMemberId,
    );
    this.auditLogService.log('NOTIFICATION_TEMPLATE_UPDATED', {
      actorId: actorMemberId,
      targetId: key,
      metadata: {
        channel: NotificationChannel.EMAIL,
        action,
        fields: Object.keys(changed),
      },
    });
    return this.toEmailView(
      key,
      Object.keys(changed).length
        ? { content: changed, updatedAt: new Date().toISOString() }
        : undefined,
    );
  }

  async resetEmail(
    key: string,
    actorMemberId?: string,
  ): Promise<EmailTemplateView> {
    this.assertEmailKey(key);
    await this.overrideRepo.delete({
      channel: NotificationChannel.EMAIL,
      templateKey: key,
    });
    this.cacheService.del(EMAIL_CACHE_KEY);
    await this.recordVersion(
      NotificationChannel.EMAIL,
      key,
      NotificationTemplateAction.RESET,
      { ...defaultWording(key) },
      actorMemberId,
    );
    this.auditLogService.log('NOTIFICATION_TEMPLATE_RESET', {
      actorId: actorMemberId,
      targetId: key,
      metadata: { channel: NotificationChannel.EMAIL },
    });
    return this.toEmailView(key, undefined);
  }

  // Cleans and checks a draft; the HTML sanitizer is passed in so this service (loaded by EmailQueueService) stays free of jsdom.
  validateEmailWording(
    dto: EmailWordingDto,
    template: EmailTemplate,
    sanitizeHtml: (html: string) => string,
  ): EmailWording {
    const allowed = {
      church_name: '',
      ...RECIPIENT_PLACEHOLDERS,
      ...template.placeholders,
    };
    const wording = {} as EmailWording;
    for (const field of EMAIL_FIELDS) {
      const raw = dto[field] ?? '';
      const value = RICH_EMAIL_FIELDS.includes(field)
        ? sanitizeHtml(raw).trim()
        : toPlainText(raw);
      this.assertPlaceholders(value, allowed, EMAIL_FIELD_LABELS[field]);
      wording[field] = value;
    }
    if (!wording.subject) {
      throw new BadRequestException("Subject can't be empty.");
    }
    if (toPlainText(template.message) && !toPlainText(wording.message)) {
      throw new BadRequestException("Message can't be empty.");
    }
    return wording;
  }

  async history(
    channel: NotificationChannel,
    key: string,
  ): Promise<NotificationTemplateVersionView[]> {
    if (channel === NotificationChannel.PUSH) this.assertPushKey(key);
    else this.assertEmailKey(key);
    const rows = await this.versionRepo.find({
      where: { channel, templateKey: key },
      relations: { createdBy: true },
      select: {
        id: true,
        action: true,
        content: true,
        createdAt: true,
        createdBy: { id: true, firstname: true, lastname: true },
      },
      order: { createdAt: 'DESC' },
      take: HISTORY_LIMIT,
    });
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      content: row.content,
      changedBy: row.createdBy
        ? `${row.createdBy.firstname ?? ''} ${row.createdBy.lastname ?? ''}`.trim()
        : null,
      createdAt: row.createdAt,
    }));
  }

  async restorePush(
    key: string,
    versionId: string,
    actorMemberId?: string,
  ): Promise<PushTemplateView> {
    this.assertPushKey(key);
    const { content } = await this.findVersion(
      NotificationChannel.PUSH,
      key,
      versionId,
    );
    return this.savePush(
      key,
      { title: content.title ?? '', body: content.body ?? '' },
      actorMemberId,
      NotificationTemplateAction.RESTORED,
    );
  }

  // Re-validated on restore, so a version that no longer fits the catalogue is refused, not sent.
  async restoreEmail(
    key: string,
    versionId: string,
    sanitizeHtml: (html: string) => string,
    actorMemberId?: string,
  ): Promise<EmailTemplateView> {
    this.assertEmailKey(key);
    const { content } = await this.findVersion(
      NotificationChannel.EMAIL,
      key,
      versionId,
    );
    return this.saveEmail(
      key,
      { ...defaultWording(key), ...content } as EmailWordingDto,
      sanitizeHtml,
      actorMemberId,
      NotificationTemplateAction.RESTORED,
    );
  }

  private async findVersion(
    channel: NotificationChannel,
    key: string,
    id: string,
  ): Promise<NotificationTemplateVersion> {
    const version = await this.versionRepo.findOne({
      where: { id, channel, templateKey: key },
    });
    if (!version) throw new NotFoundException('That version no longer exists.');
    return version;
  }

  private async recordVersion(
    channel: NotificationChannel,
    key: string,
    action: NotificationTemplateAction,
    content: Record<string, string>,
    actorMemberId?: string,
  ): Promise<void> {
    await this.versionRepo.save(
      this.versionRepo.create({
        channel,
        templateKey: key,
        action,
        content,
        createdBy: actorMemberId ? ({ id: actorMemberId } as never) : null,
      }),
    );
    const stale = await this.versionRepo.find({
      where: { channel, templateKey: key },
      select: { id: true },
      order: { createdAt: 'DESC' },
      skip: HISTORY_LIMIT,
    });
    if (stale.length) await this.versionRepo.delete(stale.map((v) => v.id));
  }

  assertEmailKey(key: string): EmailTemplate {
    if (!isCatalogueEmail(key)) {
      throw new NotFoundException(`Unknown email: ${key}`);
    }
    return EMAIL_CATALOGUE[key];
  }

  private assertPlaceholders(
    text: string,
    allowed: Record<string, string>,
    field: string,
  ): void {
    const unknown = [...text.matchAll(PLACEHOLDER)]
      .map((m) => m[1])
      .filter((name) => !(name in allowed));
    if (!unknown.length) return;
    const names = Object.keys(allowed);
    throw new BadRequestException(
      `${field} uses ${[...new Set(unknown)].map((n) => `{{${n}}}`).join(', ')}, which this email doesn't have.` +
        ` Available: ${names.map((n) => `{{${n}}}`).join(', ')}.`,
    );
  }

  private toEmailView(
    key: string,
    override?: { content: Partial<EmailWording>; updatedAt: string },
  ): EmailTemplateView {
    const template = EMAIL_CATALOGUE[key];
    const defaults = defaultWording(key);
    return {
      key,
      category: template.category,
      categoryLabel: template.category
        ? KNOWN_EMAIL_CATEGORIES[template.category].label
        : (template.group ?? 'Account emails'),
      label: template.label,
      description: template.description,
      lockedNote: template.lockedNote,
      placeholders: {
        church_name: 'Your church',
        ...RECIPIENT_PLACEHOLDERS,
        ...template.placeholders,
      },
      defaults: { ...defaults },
      wording: { ...defaults, ...(override?.content ?? {}) },
      customized: !!override && Object.keys(override.content).length > 0,
      updatedAt: override ? new Date(override.updatedAt) : null,
    };
  }

  assertPushKey(key: string): PushTemplate {
    const template = PUSH_CATALOGUE[key as PushNotificationKey];
    if (!template) throw new NotFoundException(`Unknown notification: ${key}`);
    return template;
  }

  private validate(raw: string, template: PushTemplate, field: string): string {
    const text = toPlainText(raw);
    if (!text) throw new BadRequestException(`${field} can't be empty.`);
    const available = { ...RECIPIENT_PLACEHOLDERS, ...template.placeholders };
    const unknown = [...text.matchAll(PLACEHOLDER)]
      .map((m) => m[1])
      .filter((name) => !(name in available));
    if (unknown.length) {
      const allowed = Object.keys(available);
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
      placeholders: { ...RECIPIENT_PLACEHOLDERS, ...template.placeholders },
      defaultTitle: template.title,
      defaultBody: template.body,
      title: override?.title || template.title,
      body: override?.body || template.body,
      customized: !!(override?.title || override?.body),
      updatedAt: override ? new Date(override.updatedAt) : null,
    };
  }
}
