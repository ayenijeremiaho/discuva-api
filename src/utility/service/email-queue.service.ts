import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as Handlebars from 'handlebars';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { EmailAttachment, EmailJobData } from '../processor/email.processor';
import { EmailCategory } from '../email-provider/email-category.enum';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { buildJobEnvelope } from '../../tenant/utility/job-envelope';

@Injectable()
export class EmailQueueService {
  private readonly logger = new Logger(EmailQueueService.name);
  private readonly brandingData: Record<string, string>;

  constructor(
    @InjectQueue('email') private readonly emailQueue: Queue<EmailJobData>,
    private readonly config: ConfigService,
    private readonly cls: ClsService<AppClsStore>,
  ) {
    this.brandingData = {
      church_name: this.config.get<string>('CHURCH_NAME'),
      church_address: this.config.get<string>('CHURCH_ADDRESS'),
      logo_url: this.config.get<string>('LOGO_URL'),
      product_name: this.config.get<string>('PRODUCT_NAME'),
    };
  }

  async queueEmail(
    to: string | string[],
    subject: string,
    html: string,
    cc?: string | string[],
    attachments?: EmailAttachment[],
    category?: EmailCategory,
  ): Promise<string> {
    if (category && !this.isCategoryEnabled(category)) {
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
      const html = this.compileTemplate(template, templateData);
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
      const html = this.compileTemplate(template, templateData);
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

  private isCategoryEnabled(category?: EmailCategory): boolean {
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
    };
    return this.config.get<boolean>(flagMap[category]) !== false;
  }

  private compileTemplate(template: string, data: Record<string, any>): string {
    return Handlebars.compile(template)({ ...this.brandingData, ...data });
  }
}
