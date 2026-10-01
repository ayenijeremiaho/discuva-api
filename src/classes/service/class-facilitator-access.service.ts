import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { ChurchClass } from '../entity/church-class.entity';
import { ClassFacilitator } from '../entity/class-facilitator.entity';
import { ClassEnrollment } from '../entity/class-enrollment.entity';
import { ClassSession } from '../entity/class-session.entity';
import { Assignment } from '../entity/assignment.entity';
import { AssignmentSubmission } from '../entity/assignment-submission.entity';
import { EnrollmentStatusEnum } from '../enum/enrollment-status.enum';

const NOT_FACILITATOR =
  "Only this class's facilitators can do this. Ask an admin if you should be added.";

// Facilitators (members listed on a class) manage that class from the member app.
@Injectable()
export class ClassFacilitatorAccessService {
  constructor(
    @InjectRepository(ClassFacilitator)
    private readonly facilitatorRepo: Repository<ClassFacilitator>,
    @InjectRepository(ChurchClass)
    private readonly classRepo: Repository<ChurchClass>,
    @InjectRepository(ClassEnrollment)
    private readonly enrollmentRepo: Repository<ClassEnrollment>,
    @InjectRepository(ClassSession)
    private readonly sessionRepo: Repository<ClassSession>,
    @InjectRepository(Assignment)
    private readonly assignmentRepo: Repository<Assignment>,
    @InjectRepository(AssignmentSubmission)
    private readonly submissionRepo: Repository<AssignmentSubmission>,
  ) {}

  isFacilitator(memberId: string, classId: string): Promise<boolean> {
    return this.facilitatorRepo.exists({
      where: { churchClass: { id: classId }, member: { id: memberId } },
    });
  }

  async assertFacilitator(memberId: string, classId: string): Promise<void> {
    if (!(await this.isFacilitator(memberId, classId)))
      throw new ForbiddenException(NOT_FACILITATOR);
  }

  async assertSessionFacilitator(
    memberId: string,
    sessionId: string,
  ): Promise<void> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
      relations: ['churchClass'],
    });
    if (!session) throw new NotFoundException('Session not found');
    await this.assertFacilitator(memberId, session.churchClass.id);
  }

  async assertAssignmentFacilitator(
    memberId: string,
    assignmentId: string,
  ): Promise<void> {
    const assignment = await this.assignmentRepo.findOne({
      where: { id: assignmentId },
      relations: ['churchClass'],
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    await this.assertFacilitator(memberId, assignment.churchClass.id);
  }

  async assertSubmissionFacilitator(
    memberId: string,
    submissionId: string,
  ): Promise<void> {
    const submission = await this.submissionRepo.findOne({
      where: { id: submissionId },
      relations: ['assignment', 'assignment.churchClass'],
    });
    if (!submission) throw new NotFoundException('Submission not found');
    await this.assertFacilitator(
      memberId,
      submission.assignment.churchClass.id,
    );
  }

  // Classes this member facilitates, open ones first, with how many people are on each.
  async myClasses(memberId: string) {
    const classes = await this.classRepo
      .createQueryBuilder('c')
      .innerJoin('c.facilitators', 'mine', 'mine.member_id = :memberId', {
        memberId,
      })
      .leftJoinAndSelect('c.classType', 'classType')
      .orderBy('c.status', 'ASC')
      .addOrderBy('c.startDate', 'DESC', 'NULLS LAST')
      .getMany();
    if (!classes.length) return [];
    const counts = await this.enrollmentRepo
      .createQueryBuilder('e')
      .select('e.church_class_id', 'classId')
      .addSelect('COUNT(*)', 'count')
      .where('e.church_class_id IN (:...ids)', {
        ids: classes.map((c) => c.id),
      })
      .andWhere('e.status != :cancelled', {
        cancelled: EnrollmentStatusEnum.CANCELLED,
      })
      .groupBy('e.church_class_id')
      .getRawMany<{ classId: string; count: string }>();
    const countOf = new Map(counts.map((c) => [c.classId, Number(c.count)]));
    return classes.map((c) => ({
      ...c,
      enrolledCount: countOf.get(c.id) ?? 0,
    }));
  }

  async activeEnrollmentCount(classId: string): Promise<number> {
    return this.enrollmentRepo.count({
      where: {
        churchClass: { id: classId },
        status: Not(EnrollmentStatusEnum.CANCELLED),
      },
    });
  }
}
