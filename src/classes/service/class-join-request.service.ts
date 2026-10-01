import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChurchClass } from '../entity/church-class.entity';
import { ClassEnrollment } from '../entity/class-enrollment.entity';
import { ClassJoinRequest } from '../entity/class-join-request.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { Member } from '../../member/entity/member.entity';
import { ClassJoinRequestStatusEnum } from '../enum/class-join-request-status.enum';
import { ChurchClassStatusEnum } from '../enum/church-class-status.enum';
import { EnrollmentStatusEnum } from '../enum/enrollment-status.enum';
import { ClassesService } from './classes.service';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';

export interface JoinStatus {
  openForRequests: boolean;
  classClosed: boolean;
  capacity: number | null;
  spotsLeft: number | null;
  enrollmentStatus: EnrollmentStatusEnum | null;
  enrollmentId: string | null;
  request: {
    id: string;
    status: ClassJoinRequestStatusEnum;
    createdAt: Date;
    declineReason: string | null;
  } | null;
}

@Injectable()
export class ClassJoinRequestService {
  private readonly logger = new Logger(ClassJoinRequestService.name);

  constructor(
    @InjectRepository(ClassJoinRequest)
    private readonly requestRepo: Repository<ClassJoinRequest>,
    @InjectRepository(ChurchClass)
    private readonly classRepo: Repository<ChurchClass>,
    @InjectRepository(ClassEnrollment)
    private readonly enrollmentRepo: Repository<ClassEnrollment>,
    private readonly classesService: ClassesService,
    private readonly notifications: NotificationDispatchService,
  ) {}

  // What the member sees on a class: can they ask, have they asked, are they already in.
  async joinStatus(classId: string, memberId: string): Promise<JoinStatus> {
    const churchClass = await this.getClassOrThrow(classId);
    const [enrollment, request, taken] = await Promise.all([
      this.enrollmentRepo.findOne({
        where: { churchClass: { id: classId }, member: { id: memberId } },
      }),
      this.requestRepo.findOne({
        where: { churchClass: { id: classId }, member: { id: memberId } },
        order: { createdAt: 'DESC' },
      }),
      this.placesTaken(classId),
    ]);
    return {
      openForRequests: churchClass.openForRequests,
      classClosed: churchClass.status === ChurchClassStatusEnum.CLOSED,
      capacity: churchClass.capacity,
      spotsLeft:
        churchClass.capacity === null
          ? null
          : Math.max(0, churchClass.capacity - taken),
      enrollmentStatus: enrollment?.status ?? null,
      enrollmentId: enrollment?.id ?? null,
      request: request
        ? {
            id: request.id,
            status: request.status,
            createdAt: request.createdAt,
            declineReason: request.declineReason,
          }
        : null,
    };
  }

  async request(
    classId: string,
    memberId: string,
    message?: string,
  ): Promise<ClassJoinRequest> {
    const churchClass = await this.getClassOrThrow(classId);
    if (churchClass.status === ChurchClassStatusEnum.CLOSED)
      throw new BadRequestException('This class has closed.');
    if (!churchClass.openForRequests)
      throw new ForbiddenException(
        "This class isn't taking requests. Speak to the church office to join.",
      );
    const enrollment = await this.enrollmentRepo.findOne({
      where: { churchClass: { id: classId }, member: { id: memberId } },
    });
    if (enrollment && enrollment.status !== EnrollmentStatusEnum.CANCELLED)
      throw new ConflictException(
        enrollment.status === EnrollmentStatusEnum.COMPLETED
          ? "You've already completed this class."
          : "You're already in this class.",
      );
    const pending = await this.requestRepo.exists({
      where: {
        churchClass: { id: classId },
        member: { id: memberId },
        status: ClassJoinRequestStatusEnum.PENDING,
      },
    });
    if (pending)
      throw new ConflictException(
        "You've already asked to join — the church will get back to you.",
      );
    await this.assertPlaceLeft(churchClass);
    const saved = await this.requestRepo.save(
      this.requestRepo.create({
        churchClass,
        member: { id: memberId } as Member,
        message: message?.trim() || null,
      }),
    );
    this.logger.log(`Member ${memberId} asked to join class ${classId}`);
    return saved;
  }

  async withdraw(requestId: string, memberId: string): Promise<void> {
    const request = await this.requestRepo.findOne({
      where: { id: requestId },
      relations: ['member'],
    });
    if (!request || request.member.id !== memberId)
      throw new NotFoundException('Request not found');
    if (request.status !== ClassJoinRequestStatusEnum.PENDING)
      throw new BadRequestException('This request has already been decided.');
    request.status = ClassJoinRequestStatusEnum.WITHDRAWN;
    await this.requestRepo.save(request);
  }

  async myRequests(memberId: string): Promise<ClassJoinRequest[]> {
    return this.requestRepo.find({
      where: { member: { id: memberId } },
      relations: ['churchClass', 'churchClass.classType'],
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  // Pending first, then the most recent decisions.
  async classRequests(classId: string) {
    await this.getClassOrThrow(classId);
    const rows = await this.requestRepo.find({
      where: { churchClass: { id: classId } },
      relations: ['member'],
      order: { createdAt: 'DESC' },
      take: 200,
    });
    const rank = (s: ClassJoinRequestStatusEnum) =>
      s === ClassJoinRequestStatusEnum.PENDING ? 0 : 1;
    return rows
      .sort((a, b) => rank(a.status) - rank(b.status))
      .map((r) => ({
        id: r.id,
        status: r.status,
        message: r.message,
        declineReason: r.declineReason,
        createdAt: r.createdAt,
        decidedAt: r.decidedAt,
        member: {
          id: r.member.id,
          firstname: r.member.firstname,
          lastname: r.member.lastname,
          email: r.member.email,
          phoneNumber: r.member.phoneNumber ?? null,
        },
      }));
  }

  // classId → number of pending requests, for badges on the admin class list.
  async pendingCounts(): Promise<Record<string, number>> {
    const rows = await this.requestRepo
      .createQueryBuilder('r')
      .select('r.church_class_id', 'classId')
      .addSelect('COUNT(*)', 'count')
      .where('r.status = :pending', {
        pending: ClassJoinRequestStatusEnum.PENDING,
      })
      .groupBy('r.church_class_id')
      .getRawMany<{ classId: string; count: string }>();
    return Object.fromEntries(rows.map((r) => [r.classId, Number(r.count)]));
  }

  async approve(requestId: string, adminId: string): Promise<ClassEnrollment> {
    const request = await this.getPendingOrThrow(requestId);
    await this.assertPlaceLeft(request.churchClass);
    const enrollment = await this.classesService.enrollMember({
      classId: request.churchClass.id,
      memberId: request.member.id,
    });
    Object.assign(request, {
      status: ClassJoinRequestStatusEnum.APPROVED,
      decidedAt: new Date(),
      decidedByAdmin: { id: adminId } as Admin,
    });
    await this.requestRepo.save(request);
    await this.notify(request, PushNotificationKey.CLASS_JOIN_APPROVED);
    return enrollment;
  }

  async decline(
    requestId: string,
    adminId: string,
    reason?: string,
  ): Promise<ClassJoinRequest> {
    const request = await this.getPendingOrThrow(requestId);
    Object.assign(request, {
      status: ClassJoinRequestStatusEnum.DECLINED,
      declineReason: reason?.trim() || null,
      decidedAt: new Date(),
      decidedByAdmin: { id: adminId } as Admin,
    });
    const saved = await this.requestRepo.save(request);
    await this.notify(request, PushNotificationKey.CLASS_JOIN_DECLINED);
    return saved;
  }

  private async notify(
    request: ClassJoinRequest,
    key:
      | PushNotificationKey.CLASS_JOIN_APPROVED
      | PushNotificationKey.CLASS_JOIN_DECLINED,
  ): Promise<void> {
    try {
      await this.notifications.notifyMember({
        category: EmailCategory.TRAINING_CLASSES,
        push: {
          memberIds: [request.member.id],
          key,
          vars: { class_name: request.churchClass.name },
          idempotencyKey: `class-join:${request.id}:${key}`,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Join request push failed for ${request.id}: ${(err as Error).message}`,
      );
    }
  }

  private placesTaken(classId: string): Promise<number> {
    return this.enrollmentRepo.count({
      where: {
        churchClass: { id: classId },
        status: EnrollmentStatusEnum.IN_PROGRESS,
      },
    });
  }

  private async assertPlaceLeft(churchClass: ChurchClass): Promise<void> {
    if (churchClass.capacity === null) return;
    if ((await this.placesTaken(churchClass.id)) >= churchClass.capacity)
      throw new ConflictException(
        `${churchClass.name} is full (${churchClass.capacity} places).`,
      );
  }

  private async getPendingOrThrow(
    requestId: string,
  ): Promise<ClassJoinRequest> {
    const request = await this.requestRepo.findOne({
      where: { id: requestId },
      relations: ['churchClass', 'member'],
    });
    if (!request) throw new NotFoundException('Request not found');
    if (request.status !== ClassJoinRequestStatusEnum.PENDING)
      throw new BadRequestException('This request has already been decided.');
    return request;
  }

  private async getClassOrThrow(classId: string): Promise<ChurchClass> {
    const churchClass = await this.classRepo.findOne({
      where: { id: classId },
    });
    if (!churchClass) throw new NotFoundException('Class not found');
    return churchClass;
  }
}
