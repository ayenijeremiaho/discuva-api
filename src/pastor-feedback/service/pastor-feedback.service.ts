import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { PastorFeedback } from '../entity/pastor-feedback.entity';
import { Department } from '../../department/entity/department.entity';
import { DepartmentLead } from '../../department/entity/department-lead.entity';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { Pastor } from '../../member/entity/pastor.entity';
import {
  SubmitPastorFeedbackDto,
  UpdatePastorFeedbackDto,
  RespondToFeedbackDto,
} from '../dto/pastor-feedback.dto';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { MemberAuth } from '../../auth/interface/auth.interface';

@Injectable()
export class PastorFeedbackService {
  private readonly logger = new Logger(PastorFeedbackService.name);

  constructor(
    @InjectRepository(PastorFeedback)
    private readonly feedbackRepo: Repository<PastorFeedback>,
    @InjectRepository(DepartmentLead)
    private readonly leadRepo: Repository<DepartmentLead>,
    @InjectRepository(WorkerProfile)
    private readonly workerProfileRepo: Repository<WorkerProfile>,
    @InjectRepository(Pastor)
    private readonly pastorRepo: Repository<Pastor>,
    private readonly auditLogService: AuditLogService,
    private readonly utilityService: UtilityService,
    private readonly pushService: PushNotificationService,
  ) {}

  async submitFeedback(
    dto: SubmitPastorFeedbackDto,
    currentUser: MemberAuth,
  ): Promise<PastorFeedback> {
    const workerProfileId = await this.assertIsHodOrDHod(
      currentUser,
      dto.departmentId,
    );
    const workerProfile = await this.workerProfileRepo.findOne({
      where: { id: workerProfileId },
      relations: ['member'],
    });

    const feedback = this.feedbackRepo.create({
      department: { id: dto.departmentId } as Department,
      submittedBy: { id: workerProfileId } as WorkerProfile,
      submittedByName: `${workerProfile.member.firstname} ${workerProfile.member.lastname}`,
      weekOf: dto.weekOf,
      attendanceNotes: dto.attendanceNotes,
      highlights: dto.highlights,
      challenges: dto.challenges,
      prayerRequests: dto.prayerRequests ?? null,
      additionalNotes: dto.additionalNotes ?? null,
    });

    let saved: PastorFeedback;
    try {
      saved = await this.feedbackRepo.save(feedback);
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === '23505') {
        throw new ConflictException(
          'Feedback for this department and week has already been submitted',
        );
      }
      throw err;
    }

    this.auditLogService.log('PASTOR_FEEDBACK_SUBMITTED', {
      actorId: currentUser.id,
      targetId: saved.id,
      metadata: { departmentId: dto.departmentId, weekOf: dto.weekOf },
    });
    this.logger.log(
      `Pastor feedback submitted for department ${dto.departmentId}, week ${dto.weekOf}`,
    );

    return saved;
  }

  async updateOwnFeedback(
    id: string,
    dto: UpdatePastorFeedbackDto,
    currentUser: MemberAuth,
  ): Promise<PastorFeedback> {
    const feedback = await this.getFeedbackOrThrow(id);
    if (feedback.submittedBy?.id !== currentUser.workerProfileId) {
      throw new ForbiddenException('You can only edit feedback you submitted');
    }
    return this.applyUpdate(feedback, dto, currentUser.id);
  }

  async updateFeedbackAsAdmin(
    id: string,
    dto: UpdatePastorFeedbackDto,
    actorId: string,
  ): Promise<PastorFeedback> {
    const feedback = await this.getFeedbackOrThrow(id);
    return this.applyUpdate(feedback, dto, actorId);
  }

  private async applyUpdate(
    feedback: PastorFeedback,
    dto: UpdatePastorFeedbackDto,
    actorId: string,
  ): Promise<PastorFeedback> {
    if (dto.attendanceNotes !== undefined)
      feedback.attendanceNotes = dto.attendanceNotes;
    if (dto.highlights !== undefined) feedback.highlights = dto.highlights;
    if (dto.challenges !== undefined) feedback.challenges = dto.challenges;
    if (dto.prayerRequests !== undefined)
      feedback.prayerRequests = dto.prayerRequests;
    if (dto.additionalNotes !== undefined)
      feedback.additionalNotes = dto.additionalNotes;

    const saved = await this.feedbackRepo.save(feedback);
    this.auditLogService.log('PASTOR_FEEDBACK_UPDATED', {
      actorId,
      targetId: saved.id,
      metadata: { departmentId: feedback.department.id },
    });
    return saved;
  }

  async respondAsPastor(
    id: string,
    dto: RespondToFeedbackDto,
    memberId: string,
  ): Promise<PastorFeedback> {
    const pastor = await this.pastorRepo.findOne({
      where: { member: { id: memberId } },
      relations: ['member'],
    });
    if (!pastor) {
      throw new ForbiddenException(
        'Only pastors can respond to pastor feedback',
      );
    }

    const feedback = await this.getFeedbackOrThrow(id, [
      'department',
      'submittedBy',
      'submittedBy.member',
    ]);
    feedback.pastorResponse = dto.response;
    feedback.respondedByPastor = pastor;
    feedback.respondedByPastorName = `${pastor.member.firstname} ${pastor.member.lastname}`;
    feedback.pastorRespondedAt = new Date();

    const saved = await this.feedbackRepo.save(feedback);

    this.auditLogService.log('PASTOR_FEEDBACK_RESPONDED', {
      actorId: memberId,
      targetId: saved.id,
      metadata: { departmentId: feedback.department.id },
    });

    const submitterMember = feedback.submittedBy?.member;
    if (submitterMember) {
      this.utilityService.sendEmailWithTemplate(
        submitterMember.email,
        `A pastor responded to your ${feedback.department.name} feedback`,
        'pastor-feedback-response',
        {
          name: submitterMember.firstname,
          departmentName: feedback.department.name,
          weekOf: feedback.weekOf,
          response: dto.response,
        },
        undefined,
        EmailCategory.PASTOR_FEEDBACK,
      );
      this.pushService.dispatchToMemberIds([submitterMember.id], {
        idempotencyKey: `pastor-feedback-response:${feedback.id}`,
        title: 'Pastor Response',
        body: `A pastor responded to your ${feedback.department.name} feedback for the week of ${feedback.weekOf}.`,
        url: '/pastor-feedback',
      });
    }

    return saved;
  }

  async getFeedbackForDepartment(
    departmentId: string,
    page = 1,
    limit = 10,
  ): Promise<PaginationResponseDto<PastorFeedback>> {
    const [data, total] = await this.feedbackRepo.findAndCount({
      where: { department: { id: departmentId } },
      relations: ['department', 'respondedByPastor'],
      order: { weekOf: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async getAllFeedback(filters: {
    departmentId?: string;
    weekOf?: string;
    page?: number;
    limit?: number;
  }): Promise<PaginationResponseDto<PastorFeedback>> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const where: FindOptionsWhere<PastorFeedback> = {};
    if (filters.departmentId)
      where.department = { id: filters.departmentId } as Department;
    if (filters.weekOf) where.weekOf = filters.weekOf;

    const [data, total] = await this.feedbackRepo.findAndCount({
      where,
      relations: ['department', 'respondedByPastor'],
      order: { weekOf: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async getMySubmissions(
    currentUser: MemberAuth,
    page = 1,
    limit = 10,
  ): Promise<PaginationResponseDto<PastorFeedback>> {
    if (!currentUser.workerProfileId) {
      return UtilityService.createPaginationResponse([], page, limit, 0);
    }
    const [data, total] = await this.feedbackRepo.findAndCount({
      where: { submittedBy: { id: currentUser.workerProfileId } },
      relations: ['department', 'respondedByPastor'],
      order: { weekOf: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async deleteFeedbackAsAdmin(id: string): Promise<void> {
    const feedback = await this.getFeedbackOrThrow(id);
    await this.feedbackRepo.remove(feedback);
  }

  async assertIsPastor(memberId: string): Promise<void> {
    const exists = await this.pastorRepo.exists({
      where: { member: { id: memberId } },
    });
    if (!exists) throw new ForbiddenException('Pastor access required');
  }

  private async assertIsHodOrDHod(
    currentUser: MemberAuth,
    departmentId: string,
  ): Promise<string> {
    if (!currentUser.workerProfileId) {
      throw new ForbiddenException(
        "Only a department's HOD or Assistant HOD can submit feedback",
      );
    }
    const isLead = await this.leadRepo.exists({
      where: {
        workerProfile: { id: currentUser.workerProfileId },
        department: { id: departmentId },
      },
    });
    if (!isLead) {
      throw new ForbiddenException(
        "Only this department's HOD or Assistant HOD can submit feedback for it",
      );
    }
    return currentUser.workerProfileId;
  }

  private async getFeedbackOrThrow(
    id: string,
    relations: string[] = ['department', 'submittedBy'],
  ): Promise<PastorFeedback> {
    const feedback = await this.feedbackRepo.findOne({
      where: { id },
      relations,
    });
    if (!feedback) throw new NotFoundException('Feedback not found');
    return feedback;
  }
}
