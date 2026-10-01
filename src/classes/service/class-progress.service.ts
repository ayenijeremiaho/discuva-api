import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, Not, Repository } from 'typeorm';
import { ChurchClass } from '../entity/church-class.entity';
import { ClassEnrollment } from '../entity/class-enrollment.entity';
import { ClassSession } from '../entity/class-session.entity';
import { ClassSessionAttendance } from '../entity/class-session-attendance.entity';
import { Assignment } from '../entity/assignment.entity';
import { AssignmentSubmission } from '../entity/assignment-submission.entity';
import { EnrollmentStatusEnum } from '../enum/enrollment-status.enum';
import { ClassAttendanceStatusEnum } from '../enum/class-attendance-status.enum';
import { churchDateOf } from '../util/church-time';
import { ClassesService } from './classes.service';

export interface CompletionRules {
  minAttendancePercent: number | null;
  requireAllAssignments: boolean;
}

export interface ClassProgressResult {
  rules: CompletionRules;
  sessionsHeld: number;
  sessionsTotal: number;
  people: EnrollmentProgress[];
}

export interface EnrollmentProgress {
  enrollmentId: string;
  memberId: string | null;
  guestId: string | null;
  name: string;
  email: string | null;
  status: EnrollmentStatusEnum;
  certificateIssued: boolean;
  sessionsHeld: number;
  present: number;
  absent: number;
  excused: number;
  // present ÷ (held − excused) as a percentage; null until a session has been held.
  attendancePercent: number | null;
  assignmentsTotal: number;
  assignmentsSubmitted: number;
  // Average of graded scores as a percentage of each assignment's max score.
  averageScorePercent: number | null;
  meetsRules: boolean;
  // Plain-language reasons the rules aren't met yet.
  missing: string[];
}

const pct = (num: number, den: number) =>
  den > 0 ? Math.round((num / den) * 1000) / 10 : null;

// Sessions held on or after the day the person enrolled (church time) count towards them.
const countsFor = (session: ClassSession, enrolledAt: Date) =>
  churchDateOf(new Date(session.startsAt)) >=
  churchDateOf(new Date(enrolledAt));

export function hasRules(rules: CompletionRules): boolean {
  return rules.minAttendancePercent !== null || rules.requireAllAssignments;
}

@Injectable()
export class ClassProgressService {
  constructor(
    @InjectRepository(ChurchClass)
    private readonly classRepo: Repository<ChurchClass>,
    @InjectRepository(ClassEnrollment)
    private readonly enrollmentRepo: Repository<ClassEnrollment>,
    @InjectRepository(ClassSession)
    private readonly sessionRepo: Repository<ClassSession>,
    @InjectRepository(ClassSessionAttendance)
    private readonly attendanceRepo: Repository<ClassSessionAttendance>,
    @InjectRepository(Assignment)
    private readonly assignmentRepo: Repository<Assignment>,
    @InjectRepository(AssignmentSubmission)
    private readonly submissionRepo: Repository<AssignmentSubmission>,
    private readonly classesService: ClassesService,
  ) {}

  // With completion rules, only people who meet them are completed; the rest stay in progress for a decision.
  async closeClass(classId: string): Promise<{
    closedEnrollments: number;
    needsReview: { enrollmentId: string; name: string; missing: string[] }[];
  }> {
    const { rules, people } = await this.classProgress(classId);
    if (!hasRules(rules)) {
      const { closedEnrollments } =
        await this.classesService.closeClass(classId);
      return { closedEnrollments, needsReview: [] };
    }
    const inProgress = people.filter(
      (p) => p.status === EnrollmentStatusEnum.IN_PROGRESS,
    );
    const { closedEnrollments } = await this.classesService.closeClass(
      classId,
      inProgress.filter((p) => p.meetsRules).map((p) => p.enrollmentId),
    );
    return {
      closedEnrollments,
      needsReview: inProgress
        .filter((p) => !p.meetsRules)
        .map(({ enrollmentId, name, missing }) => ({
          enrollmentId,
          name,
          missing,
        })),
    };
  }

  async classProgress(classId: string): Promise<ClassProgressResult> {
    const result = (await this.progressFor([classId])).get(classId);
    if (!result) throw new NotFoundException('Class not found');
    return result;
  }

  // One person's progress without computing the rest of the class.
  async enrollmentProgress(
    classId: string,
    enrollmentId: string,
  ): Promise<EnrollmentProgress | null> {
    const result = (await this.progressFor([classId], [enrollmentId])).get(
      classId,
    );
    return result?.people[0] ?? null;
  }

  // Progress for many classes in a fixed number of queries; optionally only some enrollments.
  async progressFor(
    classIds: string[],
    onlyEnrollmentIds?: string[],
  ): Promise<Map<string, ClassProgressResult>> {
    const out = new Map<string, ClassProgressResult>();
    if (!classIds.length) return out;
    const now = new Date();
    const [classes, enrollments, sessionCounts, held, assignments] =
      await Promise.all([
        this.classRepo.find({
          where: { id: In(classIds) },
          select: {
            id: true,
            minAttendancePercent: true,
            requireAllAssignments: true,
          },
        }),
        this.enrollmentRepo.find({
          where: {
            churchClass: { id: In(classIds) },
            status: Not(EnrollmentStatusEnum.CANCELLED),
            ...(onlyEnrollmentIds && { id: In(onlyEnrollmentIds) }),
          },
          relations: ['member', 'guest', 'churchClass'],
        }),
        this.sessionRepo
          .createQueryBuilder('s')
          .select('s.church_class_id', 'classId')
          .addSelect('COUNT(*)', 'count')
          .where('s.church_class_id IN (:...classIds)', { classIds })
          .groupBy('s.church_class_id')
          .getRawMany<{ classId: string; count: string }>(),
        this.sessionRepo.find({
          where: {
            churchClass: { id: In(classIds) },
            startsAt: LessThanOrEqual(now),
          },
          relations: ['churchClass'],
          select: { id: true, startsAt: true, churchClass: { id: true } },
        }),
        this.assignmentRepo.find({
          where: { churchClass: { id: In(classIds) }, isPublished: true },
          relations: ['churchClass'],
          select: { id: true, maxScore: true, churchClass: { id: true } },
        }),
      ]);

    const enrollmentIds = enrollments.map((e) => e.id);
    const memberIds = enrollments
      .map((e) => e.member?.id)
      .filter((id): id is string => !!id);
    const [marks, submissions] = await Promise.all([
      held.length && enrollmentIds.length
        ? this.attendanceRepo
            .createQueryBuilder('a')
            .select('a.enrollment_id', 'enrollmentId')
            .addSelect('a.session_id', 'sessionId')
            .addSelect('a.status', 'status')
            .where('a.enrollment_id IN (:...enrollmentIds)', { enrollmentIds })
            .andWhere('a.session_id IN (:...sessionIds)', {
              sessionIds: held.map((s) => s.id),
            })
            .getRawMany<{
              enrollmentId: string;
              sessionId: string;
              status: ClassAttendanceStatusEnum;
            }>()
        : Promise.resolve([]),
      assignments.length && enrollmentIds.length
        ? this.submissionRepo
            .createQueryBuilder('s')
            .select('s.assignment_id', 'assignmentId')
            .addSelect('s.member_id', 'memberId')
            .addSelect('s.class_enrollment_id', 'enrollmentId')
            .addSelect('s.score', 'score')
            .where('s.assignment_id IN (:...assignmentIds)', {
              assignmentIds: assignments.map((a) => a.id),
            })
            .andWhere(
              memberIds.length
                ? '(s.member_id IN (:...memberIds) OR s.class_enrollment_id IN (:...enrollmentIds))'
                : 's.class_enrollment_id IN (:...enrollmentIds)',
              { memberIds, enrollmentIds },
            )
            .getRawMany<{
              assignmentId: string;
              memberId: string | null;
              enrollmentId: string | null;
              score: number | null;
            }>()
        : Promise.resolve([]),
    ]);

    const group = <T, K>(rows: T[], key: (r: T) => K) => {
      const m = new Map<K, T[]>();
      for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
      return m;
    };
    const heldByClass = group(held, (s) => s.churchClass.id);
    const assignmentsByClass = group(assignments, (a) => a.churchClass.id);
    const marksByEnrollment = group(marks, (m) => m.enrollmentId);
    const subsByMember = group(
      submissions.filter((s) => s.memberId),
      (s) => s.memberId!,
    );
    const subsByEnrollment = group(
      submissions.filter((s) => s.enrollmentId),
      (s) => s.enrollmentId!,
    );
    const enrollmentsByClass = group(enrollments, (e) => e.churchClass.id);
    const maxOf = new Map(assignments.map((a) => [a.id, a.maxScore]));
    const totalOf = new Map(
      sessionCounts.map((c) => [c.classId, Number(c.count)]),
    );

    for (const c of classes) {
      const rules: CompletionRules = {
        minAttendancePercent: c.minAttendancePercent,
        requireAllAssignments: c.requireAllAssignments,
      };
      const classHeld = heldByClass.get(c.id) ?? [];
      const classAssignmentIds = new Set(
        (assignmentsByClass.get(c.id) ?? []).map((a) => a.id),
      );
      const assignmentsTotal = classAssignmentIds.size;
      const people = (enrollmentsByClass.get(c.id) ?? []).map((e) => {
        const theirSessions = classHeld.filter((s) =>
          countsFor(s, e.enrolledAt),
        );
        const sessionIds = new Set(theirSessions.map((s) => s.id));
        const own = (marksByEnrollment.get(e.id) ?? []).filter((m) =>
          sessionIds.has(m.sessionId),
        );
        const count = (st: ClassAttendanceStatusEnum) =>
          own.filter((m) => m.status === st).length;
        const present = count(ClassAttendanceStatusEnum.PRESENT);
        const excused = count(ClassAttendanceStatusEnum.EXCUSED);
        const subs = (
          e.member
            ? (subsByMember.get(e.member.id) ?? [])
            : (subsByEnrollment.get(e.id) ?? [])
        ).filter((s) => classAssignmentIds.has(s.assignmentId));
        const graded = subs.filter(
          (s) => s.score !== null && s.score !== undefined,
        );
        const averageScorePercent = graded.length
          ? Math.round(
              (graded.reduce(
                (sum, s) =>
                  sum +
                  (Number(s.score) / (maxOf.get(s.assignmentId) || 100)) * 100,
                0,
              ) /
                graded.length) *
                10,
            ) / 10
          : null;
        const attendancePercent = pct(present, theirSessions.length - excused);
        const missing: string[] = [];
        if (
          rules.minAttendancePercent !== null &&
          (attendancePercent ?? 0) < rules.minAttendancePercent
        )
          missing.push(
            `Attendance ${attendancePercent ?? 0}% (needs ${rules.minAttendancePercent}%)`,
          );
        if (rules.requireAllAssignments && subs.length < assignmentsTotal)
          missing.push(
            `${assignmentsTotal - subs.length} assignment(s) not submitted`,
          );
        return {
          enrollmentId: e.id,
          memberId: e.member?.id ?? null,
          guestId: e.guest?.id ?? null,
          name: e.member
            ? `${e.member.firstname} ${e.member.lastname}`
            : `${e.guest?.firstName ?? ''} ${e.guest?.lastName ?? ''}`.trim(),
          email: e.member?.email ?? e.guest?.email ?? null,
          status: e.status,
          certificateIssued: e.certificateIssued,
          sessionsHeld: theirSessions.length,
          present,
          absent: count(ClassAttendanceStatusEnum.ABSENT),
          excused,
          attendancePercent,
          assignmentsTotal,
          assignmentsSubmitted: subs.length,
          averageScorePercent,
          meetsRules: missing.length === 0,
          missing,
        };
      });
      people.sort((a, b) => a.name.localeCompare(b.name));
      out.set(c.id, {
        rules,
        sessionsHeld: classHeld.length,
        sessionsTotal: totalOf.get(c.id) ?? 0,
        people,
      });
    }
    return out;
  }
}
