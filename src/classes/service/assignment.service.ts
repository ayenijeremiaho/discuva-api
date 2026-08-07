import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Assignment } from '../entity/assignment.entity';
import { AssignmentSubmission } from '../entity/assignment-submission.entity';
import { ChurchClass } from '../entity/church-class.entity';
import { Member } from '../../member/entity/member.entity';
import { Admin } from '../../admin/entity/admin.entity';
import {
  CreateAssignmentDto,
  GradeAssignmentDto,
  SubmitAssignmentDto,
  UpdateAssignmentDto,
} from '../dto/assignment.dto';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';

@Injectable()
export class AssignmentService {
  private readonly logger = new Logger(AssignmentService.name);

  constructor(
    @InjectRepository(Assignment)
    private readonly assignmentRepo: Repository<Assignment>,
    @InjectRepository(AssignmentSubmission)
    private readonly submissionRepo: Repository<AssignmentSubmission>,
    @InjectRepository(ChurchClass)
    private readonly classRepo: Repository<ChurchClass>,
  ) {}

  async create(classId: string, dto: CreateAssignmentDto): Promise<Assignment> {
    const churchClass = await this.classRepo.findOneBy({ id: classId });
    if (!churchClass) throw new NotFoundException('Class not found');

    const assignment = this.assignmentRepo.create({
      churchClass,
      title: dto.title,
      instructions: dto.instructions ?? null,
      maxScore: dto.maxScore ?? 100,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      isPublished: dto.isPublished ?? true,
    });
    return this.assignmentRepo.save(assignment);
  }

  async update(id: string, dto: UpdateAssignmentDto): Promise<Assignment> {
    const assignment = await this.getAssignmentOrThrow(id);

    if (dto.title !== undefined) assignment.title = dto.title;
    if (dto.instructions !== undefined)
      assignment.instructions = dto.instructions;
    if (dto.maxScore !== undefined) assignment.maxScore = dto.maxScore;
    if (dto.dueDate !== undefined)
      assignment.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    if (dto.isPublished !== undefined) assignment.isPublished = dto.isPublished;

    return this.assignmentRepo.save(assignment);
  }

  async delete(id: string): Promise<void> {
    const assignment = await this.getAssignmentOrThrow(id);
    await this.assignmentRepo.remove(assignment);
  }

  async getForClass(classId: string): Promise<Assignment[]> {
    return this.assignmentRepo.find({
      where: { churchClass: { id: classId } },
      order: { createdAt: 'DESC' },
    });
  }

  // Published assignments only, each merged with the caller's own
  // submission (if any) so the member app can show submitted/scored state
  // in one call rather than a second round-trip per assignment.
  async getAvailableForMember(
    classId: string,
    memberId: string,
  ): Promise<
    Array<Assignment & { mySubmission: AssignmentSubmission | null }>
  > {
    const assignments = await this.assignmentRepo.find({
      where: { churchClass: { id: classId }, isPublished: true },
      order: { dueDate: 'ASC' },
    });
    if (assignments.length === 0) return [];

    const mySubmissions = await this.submissionRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.assignment', 'assignment')
      .where('s.member_id = :memberId', { memberId })
      .andWhere('s.assignment_id IN (:...ids)', {
        ids: assignments.map((a) => a.id),
      })
      .getMany();
    const byAssignmentId = new Map(
      mySubmissions.map((s) => [s.assignment.id, s]),
    );

    return assignments.map((a) => ({
      ...a,
      mySubmission: byAssignmentId.get(a.id) ?? null,
    }));
  }

  async submit(
    assignmentId: string,
    memberId: string,
    dto: SubmitAssignmentDto,
  ): Promise<AssignmentSubmission> {
    const assignment = await this.getAssignmentOrThrow(assignmentId);
    if (!assignment.isPublished) {
      throw new BadRequestException(
        'This assignment is not open for submissions',
      );
    }

    const existing = await this.submissionRepo.findOne({
      where: { assignment: { id: assignmentId }, member: { id: memberId } },
    });

    if (existing) {
      if (existing.gradedAt) {
        throw new BadRequestException(
          'This assignment has already been graded and can no longer be resubmitted',
        );
      }
      existing.content = dto.content;
      existing.submittedAt = new Date();
      return this.submissionRepo.save(existing);
    }

    const submission = this.submissionRepo.create({
      assignment,
      member: { id: memberId } as Member,
      content: dto.content,
    });
    return this.submissionRepo.save(submission);
  }

  async getSubmissions(
    assignmentId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginationResponseDto<AssignmentSubmission>> {
    await this.getAssignmentOrThrow(assignmentId);
    const [data, total] = await this.submissionRepo.findAndCount({
      where: { assignment: { id: assignmentId } },
      relations: ['member'],
      order: { submittedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async grade(
    submissionId: string,
    dto: GradeAssignmentDto,
    adminId: string,
  ): Promise<AssignmentSubmission> {
    const submission = await this.submissionRepo.findOne({
      where: { id: submissionId },
      relations: ['assignment', 'member'],
    });
    if (!submission) throw new NotFoundException('Submission not found');

    if (dto.score > submission.assignment.maxScore) {
      throw new BadRequestException(
        `Score cannot exceed this assignment's max score of ${submission.assignment.maxScore}`,
      );
    }

    submission.score = dto.score;
    submission.feedback = dto.feedback ?? null;
    submission.gradedBy = { id: adminId } as Admin;
    submission.gradedAt = new Date();

    const saved = await this.submissionRepo.save(submission);
    this.logger.log(
      `Submission ${submissionId} graded ${dto.score}/${submission.assignment.maxScore}`,
    );
    return saved;
  }

  private async getAssignmentOrThrow(id: string): Promise<Assignment> {
    const assignment = await this.assignmentRepo.findOneBy({ id });
    if (!assignment) throw new NotFoundException('Assignment not found');
    return assignment;
  }
}
