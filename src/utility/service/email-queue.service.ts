import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bull';
import { Repository } from 'typeorm';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as Handlebars from 'handlebars';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { EmailAttachment, EmailJobData } from '../processor/email.processor';
import { EmailCategory } from '../email-provider/email-category.enum';
import { EmailCategorySettingsService } from '../../email-category-settings/service/email-category-settings.service';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { buildJobEnvelope } from '../../tenant/utility/job-envelope';
import { CacheService } from './cache.service';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { buildAdminUrl, buildTenantUrl } from '../../tenant/utility/tenant-url';

@Injectable()
export class EmailQueueService {
  private readonly logger = new Logger(EmailQueueService.name);
  private readonly cacheTtl: number;

  constructor(
    @InjectQueue('email') private readonly emailQueue: Queue<EmailJobData>,
    private readonly config: ConfigService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly cacheService: CacheService,
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    private readonly emailCategorySettingsService: EmailCategorySettingsService,
  ) {
    this.cacheTtl = this.config.get<number>('CACHE_TTL_REFERENCE_SECONDS', 300);
  }

  async queueEmail(
    to: string | string[],
    subject: string,
    html: string,
    cc?: string | string[],
    attachments?: EmailAttachment[],
    category?: EmailCategory,
  ): Promise<string> {
    if (category && !(await this.isCategoryEnabled(category))) {
      this.logger.debug(
        `Email suppressed (category ${category} disabled): "${subject}"`,
      );
      return '';
    }
    const job = await this.emailQueue.add(
      'send',
      { to, cc, subject, html, attachments, ...buildJobEnvelope(this.cls) },
      {
        attempts: 5,
        backoff: { type: 'fixed', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
    this.logger.debug(
      `Email queued: "${subject}" to ${Array.isArray(to) ? to.join(', ') : to} (job ${job.id})`,
    );
    return String(job.id);
  }

  async queueEmailWithTemplate(
    to: string | string[],
    subject: string,
    templateName: string,
    templateData: Record<string, any>,
    cc?: string | string[],
    category?: EmailCategory,
  ): Promise<string> {
    const templatePath = path.resolve(
      __dirname,
      '..',
      'templates',
      `${templateName}.html`,
    );
    try {
      const template = fs.readFileSync(templatePath, 'utf-8');
      const html = await this.compileTemplate(template, templateData);
      return this.queueEmail(to, subject, html, cc, undefined, category);
    } catch (error) {
      this.logger.error(`Failed to read template ${templateName}: ${error}`);
      throw error;
    }
  }

  async queueEmailWithTemplateAndAttachments(
    to: string | string[],
    subject: string,
    templateName: string,
    templateData: Record<string, any>,
    attachments: Array<{ filename: string; content: Buffer }>,
    cc?: string | string[],
    category?: EmailCategory,
  ): Promise<string> {
    const templatePath = path.resolve(
      __dirname,
      '..',
      'templates',
      `${templateName}.html`,
    );
    try {
      const template = fs.readFileSync(templatePath, 'utf-8');
      const html = await this.compileTemplate(template, templateData);
      const emailAttachments: EmailAttachment[] = attachments.map((a) => ({
        filename: a.filename,
        content: a.content.toString('base64'),
        encoding: 'base64',
      }));
      return this.queueEmail(to, subject, html, cc, emailAttachments, category);
    } catch (error) {
      this.logger.error(`Failed to read template ${templateName}: ${error}`);
      throw error;
    }
  }

  async getQueueSize(): Promise<number> {
    return this.emailQueue.count();
  }

  async getStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    return this.emailQueue.getJobCounts();
  }

  // Two independent layers: the env var is a platform-wide kill switch
  // (requires a redeploy, rarely touched), the EmailCategorySettingsService
  // check is the per-tenant override an admin can flip from the portal.
  // Either one being off suppresses the send.
  private async isCategoryEnabled(category?: EmailCategory): Promise<boolean> {
    if (!category) return true;
    const flagMap: Record<EmailCategory, string> = {
      [EmailCategory.ATTENDANCE_CHECKIN]: 'EMAIL_ATTENDANCE_CHECKIN_ENABLED',
      [EmailCategory.BIRTHDAY]: 'EMAIL_BIRTHDAY_ENABLED',
      [EmailCategory.EVENT_REMINDER]: 'EMAIL_EVENT_REMINDER_ENABLED',
      [EmailCategory.PRAYER_REMINDER]: 'EMAIL_PRAYER_REMINDER_ENABLED',
      [EmailCategory.FOLLOW_UP]: 'EMAIL_FOLLOW_UP_ENABLED',
      [EmailCategory.ASSET_ALERTS]: 'EMAIL_ASSET_ALERTS_ENABLED',
      [EmailCategory.GIVING_RECEIPT]: 'EMAIL_GIVING_RECEIPT_ENABLED',
      [EmailCategory.FINANCE_ALERTS]: 'EMAIL_FINANCE_ALERTS_ENABLED',
      [EmailCategory.SESSION_REPORT]: 'EMAIL_SESSION_REPORT_ENABLED',
      [EmailCategory.INCIDENT_REPORT]: 'EMAIL_INCIDENT_REPORT_ENABLED',
      [EmailCategory.CHILDREN_CHURCH]: 'EMAIL_CHILDREN_CHURCH_ENABLED',
      [EmailCategory.LOGIN_ALERT]: 'EMAIL_LOGIN_ALERT_ENABLED',
      [EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT]:
        'EMAIL_SERVICE_PROGRAMME_ASSIGNMENT_ENABLED',
      [EmailCategory.PASTOR_FEEDBACK]: 'EMAIL_PASTOR_FEEDBACK_ENABLED',
      [EmailCategory.MEMBERSHIP_ANNIVERSARY]:
        'EMAIL_MEMBERSHIP_ANNIVERSARY_ENABLED',
      [EmailCategory.ASSIGNMENT_REMINDER]: 'EMAIL_ASSIGNMENT_REMINDER_ENABLED',
      [EmailCategory.CLASS_SESSION_REMINDER]:
        'EMAIL_CLASS_SESSION_REMINDER_ENABLED',
    };
    if (this.config.get<boolean>(flagMap[category]) === false) return false;
    return this.emailCategorySettingsService.isEnabled(category);
  }

  private async compileTemplate(
    template: string,
    data: Record<string, any>,
  ): Promise<string> {
    const brandingData = await this.resolveBrandingData();
    return Handlebars.compile(template)({ ...brandingData, ...data });
  }

  // church_name/church_address/logo_url must come from the CURRENT tenant,
  // not a single global value — this used to be computed once in the
  // constructor from process.env, which meant every tenant's emails carried
  // whichever church happened to be in .env at boot. product_name stays
  // global (it's the SaaS product name, not a per-church value).
  //
  // support_email has no env fallback (unlike the fields above) — showing a
  // wrong/generic contact address would be actively misleading, not just
  // generic, so templates gate it behind {{#if support_email}} and simply
  // omit the line when a tenant hasn't set one.
  //
  // login_url: LOGIN_URL is a bare, tenant-less base URL (discuva-member is
  // on a real wildcard — one build serves every tenant, subdomain inserted
  // at send time). admin_login_url is different: discuva-admin is a single
  // fixed host with NO wildcard (docs/MULTI_TENANT_MIGRATION.md Phase 9l),
  // so its tenant identifier travels as a `subdomain` query param instead
  // (buildAdminUrl) — discuva-admin's login form reads and pre-fills its
  // "Church Subdomain" field from it, rather than the URL's host carrying
  // it the way member's does.
  private async resolveBrandingData(): Promise<Record<string, string>> {
    const fallback = {
      church_name: this.config.get<string>('CHURCH_NAME'),
      church_address: this.config.get<string>('CHURCH_ADDRESS'),
      logo_url: this.config.get<string>('LOGO_URL'),
      product_name: this.config.get<string>('PRODUCT_NAME'),
      login_url: this.config.get<string>('LOGIN_URL'),
      admin_login_url: this.config.get<string>('ADMIN_LOGIN_URL'),
    };

    const tenant = await this.getCurrentTenant();
    if (!tenant) return { ...fallback, support_email: '' };

    return {
      church_name: tenant.name || fallback.church_name,
      church_address: tenant.address || fallback.church_address,
      logo_url: tenant.logoUrl || fallback.logo_url,
      product_name: fallback.product_name,
      support_email: tenant.supportEmail ?? '',
      login_url: buildTenantUrl(fallback.login_url, tenant.subdomain),
      admin_login_url: buildAdminUrl(fallback.admin_login_url, '', {
        subdomain: tenant.subdomain,
      }),
    };
  }

  // Public escape hatch for the one call site (AuthService's session
  // security alert) that has to pick between LOGIN_URL and ADMIN_LOGIN_URL
  // itself based on which surface a session belongs to — every other caller
  // just gets both via resolveBrandingData's auto-injected login_url/
  // admin_login_url and never needs this directly.
  async resolveTenantUrl(surface: 'member' | 'admin'): Promise<string> {
    const tenant = await this.getCurrentTenant();
    if (surface === 'admin') {
      const base = this.config.get<string>('ADMIN_LOGIN_URL');
      return tenant
        ? buildAdminUrl(base, '', { subdomain: tenant.subdomain })
        : base;
    }
    const base = this.config.get<string>('LOGIN_URL');
    return tenant ? buildTenantUrl(base, tenant.subdomain) : base;
  }

  // Escape hatch for member-facing deep links that aren't the login page
  // itself (e.g. a guest's class portal link) — same subdomain-insertion as
  // resolveTenantUrl('member'), but for an arbitrary path.
  async resolveMemberUrl(path: string): Promise<string> {
    const tenant = await this.getCurrentTenant();
    const base = this.config.get<string>('LOGIN_URL');
    return tenant ? buildTenantUrl(base, tenant.subdomain, path) : base;
  }

  private async getCurrentTenant(): Promise<Tenant | null> {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) return null;
    const tenant = await this.cacheService.getOrSet(
      `tenant-branding:${tenantId}`,
      () => this.tenantRepository.findOneBy({ id: tenantId }),
      this.cacheTtl,
    );
    return tenant ?? null;
  }
}
