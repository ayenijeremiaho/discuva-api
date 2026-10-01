import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClassEnrollment } from '../entity/class-enrollment.entity';
import { EnrollmentStatusEnum } from '../enum/enrollment-status.enum';
import { ClassesService } from './classes.service';
import { PdfService } from '../../utility/service/pdf.service';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';
import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';
import { AuditLogService } from '../../utility/service/audit-log.service';

const PREFIX = 'CERT';
const format = (year: number, n: number) =>
  `${PREFIX}-${year}-${String(n).padStart(4, '0')}`;

@Injectable()
export class ClassCertificateService {
  private readonly logger = new Logger(ClassCertificateService.name);

  constructor(
    @InjectRepository(ClassEnrollment)
    private readonly enrollmentRepo: Repository<ClassEnrollment>,
    private readonly classesService: ClassesService,
    private readonly pdfService: PdfService,
    private readonly notifications: NotificationDispatchService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // Issues (or re-issues) a certificate; without a number the next CERT-YYYY-NNNN is used.
  async issue(
    enrollmentId: string,
    certificateNumber: string | undefined,
    actorId: string,
  ): Promise<ClassEnrollment> {
    const number = certificateNumber?.trim() || (await this.nextNumber());
    const saved = await this.classesService.issueCertificate(
      enrollmentId,
      { certificateNumber: number },
      actorId,
    );
    await this.notifyReady(enrollmentId);
    return saved;
  }

  // Every completed enrollment in the class that doesn't have a certificate yet.
  async issueAll(
    classId: string,
    actorId: string,
  ): Promise<{ issued: number }> {
    const pending = await this.enrollmentRepo.find({
      where: {
        churchClass: { id: classId },
        status: EnrollmentStatusEnum.COMPLETED,
        certificateIssued: false,
      },
      relations: ['member', 'guest', 'churchClass'],
      order: { completedAt: 'ASC' },
    });
    if (!pending.length) return { issued: 0 };
    const year = new Date().getFullYear();
    let last = await this.lastNumber(year);
    const now = new Date();
    for (const e of pending) {
      last += 1;
      e.certificateIssued = true;
      e.certificateIssuedAt = now;
      e.certificateNumber = format(year, last);
    }
    await this.enrollmentRepo.save(pending);
    for (const e of pending) {
      this.auditLogService.log('CLASS_CERTIFICATE_ISSUED', {
        actorId,
        targetId: e.member?.id ?? e.guest?.id,
        targetEmail: e.member?.email ?? e.guest?.email,
        targetName: e.member
          ? `${e.member.firstname} ${e.member.lastname}`
          : `${e.guest?.firstName ?? ''} ${e.guest?.lastName ?? ''}`.trim(),
        metadata: {
          enrollmentId: e.id,
          classId,
          certificateNumber: e.certificateNumber,
        },
      });
    }
    const memberIds = pending
      .map((e) => e.member?.id)
      .filter((id): id is string => !!id);
    if (memberIds.length) {
      await this.pushReady(
        memberIds,
        pending[0].churchClass.name,
        `class-certificates:${classId}:${now.getTime()}`,
      );
    }
    this.logger.log(
      `Issued ${pending.length} certificates for class ${classId}`,
    );
    return { issued: pending.length };
  }

  // Serialised with an advisory lock so two issues at once can't take the same number.
  async nextNumber(year = new Date().getFullYear()): Promise<string> {
    return format(year, (await this.lastNumber(year)) + 1);
  }

  // Takes the numbering lock (held until the request's transaction ends) and returns the highest number used this year.
  private async lastNumber(year: number): Promise<number> {
    await this.enrollmentRepo.query(
      `SELECT pg_advisory_xact_lock(hashtext('class-certificate-number'))`,
    );
    const rows: { certificate_number: string }[] =
      await this.enrollmentRepo.query(
        `SELECT certificate_number FROM class_enrollments
         WHERE certificate_number LIKE $1
         ORDER BY length(certificate_number) DESC, certificate_number DESC LIMIT 1`,
        [`${PREFIX}-${year}-%`],
      );
    return Number(rows[0]?.certificate_number.split('-')[2] ?? 0) || 0;
  }

  // memberId: when set, the enrollment must be that member's own.
  async pdf(
    enrollmentId: string,
    opts: { memberId?: string; guestOnly?: boolean } = {},
  ): Promise<{ buffer: Buffer; filename: string }> {
    const e = await this.enrollmentRepo.findOne({
      where: { id: enrollmentId },
      relations: [
        'member',
        'guest',
        'churchClass',
        'churchClass.classType',
        'churchClass.facilitators',
        'churchClass.facilitators.member',
      ],
    });
    if (!e) throw new NotFoundException('Enrollment not found');
    if (opts.memberId && e.member?.id !== opts.memberId)
      throw new ForbiddenException('This certificate belongs to someone else.');
    if (opts.guestOnly && !e.guest)
      throw new NotFoundException('Enrollment not found');
    if (!e.certificateIssued)
      throw new BadRequestException("This certificate hasn't been issued yet.");
    const name = e.member
      ? `${e.member.firstname} ${e.member.lastname}`
      : `${e.guest!.firstName} ${e.guest!.lastName}`;
    const signatories = (e.churchClass.facilitators ?? [])
      .sort((a, b) => a.order - b.order)
      .map((f) =>
        f.member ? `${f.member.firstname} ${f.member.lastname}` : f.guestName,
      )
      .filter((n): n is string => !!n);
    const completed = e.completedAt ?? e.certificateIssuedAt ?? new Date();
    const buffer = await this.pdfService.generateClassCertificate({
      recipientName: name,
      className: e.churchClass.name,
      classTypeName: e.churchClass.classType?.name ?? null,
      completedOn: new Date(completed).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: CHURCH_TIMEZONE,
      }),
      certificateNumber: e.certificateNumber,
      signatories,
    });
    const slug = `${name}-${e.churchClass.name}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return { buffer, filename: `certificate-${slug}.pdf` };
  }

  private async notifyReady(enrollmentId: string): Promise<void> {
    const e = await this.enrollmentRepo.findOne({
      where: { id: enrollmentId },
      relations: ['member', 'churchClass'],
    });
    if (!e?.member) return;
    await this.pushReady(
      [e.member.id],
      e.churchClass.name,
      `class-certificate:${e.id}:${e.certificateNumber ?? ''}`,
    );
  }

  private async pushReady(
    memberIds: string[],
    className: string,
    idempotencyKey: string,
  ): Promise<void> {
    try {
      await this.notifications.notifyMember({
        category: EmailCategory.TRAINING_CLASSES,
        push: {
          memberIds,
          key: PushNotificationKey.CLASS_CERTIFICATE_READY,
          vars: { class_name: className },
          idempotencyKey,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Certificate push failed (${idempotencyKey}): ${(err as Error).message}`,
      );
    }
  }
}
