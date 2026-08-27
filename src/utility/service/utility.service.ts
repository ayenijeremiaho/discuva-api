import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { PaginationResponseDto } from '../dto/pagination-response.dto';
import { plainToInstance } from 'class-transformer';
import { ClassConstructor } from 'class-transformer/types/interfaces';
import { DATE_OF_BIRTH_REGEX } from '../constants/regex.constant';
import { EmailQueueService } from './email-queue.service';
import { EmailCategory } from '../email-provider/email-category.enum';

@Injectable()
export class UtilityService {
  constructor(private readonly emailQueueService: EmailQueueService) {}

  public static isValidDateOfBirthFormat(date?: string): boolean {
    if (!date) return false;
    return DATE_OF_BIRTH_REGEX.test(date);
  }

  public static isValidDateFormat(date?: string): boolean {
    if (!date) return false;
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    return regex.test(date) && !Number.isNaN(new Date(date).getTime());
  }

  public static calculateDistanceInMeters(
    userLatitude: number,
    userLongitude: number,
    eventLatitude: number,
    eventLongitude: number,
  ): number {
    const R = 6371;
    const dLat = this.deg2rad(eventLatitude - userLatitude);
    const dLon = this.deg2rad(eventLongitude - userLongitude);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(userLatitude)) *
        Math.cos(this.deg2rad(eventLatitude)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c * 1000;
  }

  private static deg2rad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  public static createPaginationResponse<T>(
    data: T[],
    page: number,
    limit: number,
    total: number = 0,
  ): PaginationResponseDto<T> {
    const totalPages = total > 0 ? Math.ceil(total / limit) : 1;
    return { data, page, limit, totalCount: total, totalPages };
  }

  public static getPaginationResponseDto<I, O>(
    response: PaginationResponseDto<I>,
    classConstructor: ClassConstructor<O>,
  ): PaginationResponseDto<O> {
    const data = response.data.map(
      (value) =>
        plainToInstance(classConstructor, value, {
          excludeExtraneousValues: true,
        }) as O,
    );
    return { ...response, data };
  }

  public static capitalizeFirstLetter(name: string): string {
    if (!name) return name;
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }

  public static generateRandomPassword(): string {
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const digits = '0123456789';
    const special = '@$!%*?&';
    const all = upper + lower + digits + special;

    const rand = (charset: string) =>
      charset[randomBytes(1)[0] % charset.length];

    const required = [rand(upper), rand(lower), rand(digits), rand(special)];
    const rest = Array.from({ length: 8 }, () => rand(all));

    return [...required, ...rest].sort(() => randomBytes(1)[0] - 128).join('');
  }

  public static async hashValue(value: string): Promise<string> {
    return argon2.hash(value);
  }

  public static async verifyHashedValue(
    value: string,
    hashedValue: string,
  ): Promise<boolean> {
    return argon2.verify(hashedValue, value);
  }

  public sendEmail(
    to: string | [string],
    subject: string,
    body: string,
    cc?: string | [string],
    category?: EmailCategory,
  ): void {
    this.emailQueueService.queueEmail(
      to,
      subject,
      body,
      cc,
      undefined,
      category,
    );
  }

  public sendEmailWithTemplate(
    to: string | [string],
    subject: string,
    templateName: string,
    templateData: Record<string, any>,
    cc?: string | [string],
    category?: EmailCategory,
  ): void {
    this.emailQueueService.queueEmailWithTemplate(
      to,
      subject,
      templateName,
      templateData,
      cc,
      category,
    );
  }

  // Delegates to EmailQueueService.resolveTenantUrl — see its own doc
  // comment for why this exists alongside the auto-injected login_url/
  // admin_login_url template variables.
  public resolveTenantLoginUrl(surface: 'member' | 'admin'): Promise<string> {
    return this.emailQueueService.resolveTenantUrl(surface);
  }

  // Delegates to EmailQueueService.resolveMemberUrl — for member-facing
  // deep links other than the login page itself (e.g. a guest's class
  // portal link).
  public resolveMemberUrl(path: string): Promise<string> {
    return this.emailQueueService.resolveMemberUrl(path);
  }

  public sendEmailWithAttachment(
    to: string | [string],
    subject: string,
    templateName: string,
    templateData: Record<string, any>,
    attachments: Array<{ filename: string; content: Buffer }>,
    category?: EmailCategory,
  ): void {
    this.emailQueueService.queueEmailWithTemplateAndAttachments(
      to,
      subject,
      templateName,
      templateData,
      attachments,
      undefined,
      category,
    );
  }
}
