import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, QueryFailedError, Repository } from 'typeorm';
import { SundaySchoolClass } from '../entity/sunday-school-class.entity';
import { SundaySchoolMember } from '../entity/sunday-school-member.entity';
import { SundaySchoolSession } from '../entity/sunday-school-session.entity';
import { SundaySchoolAttendance } from '../entity/sunday-school-attendance.entity';
import { SundaySchoolQuestion } from '../entity/sunday-school-question.entity';
import { SundaySchoolAttendanceStatus } from '../enums/sunday-school-attendance-status.enum';
import {
  CreateSundaySchoolClassDto,
  UpdateSundaySchoolClassDto,
} from '../dto/create-sunday-school-class.dto';
import { AssignSundaySchoolMemberDto } from '../dto/assign-sunday-school-member.dto';
import { CreateSundaySchoolSessionDto } from '../dto/create-sunday-school-session.dto';
import { BulkMarkAttendanceDto } from '../dto/bulk-mark-attendance.dto';
import { CheckInFirstTimerDto } from '../dto/checkin-first-timer.dto';
import { FollowUpService } from '../../follow-up/service/follow-up.service';
import {
  AskQuestionDto,
  AnswerQuestionDto,
} from '../dto/sunday-school-question.dto';
import { Member } from '../../member/entity/member.entity';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { DepartmentCapability } from '../../department/enums/department-capability.enum';
import { DepartmentAccessService } from '../../department/service/department-access.service';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';

export interface SessionRosterEntry {
  memberId: string;
  name: string;
  status: SundaySchoolAttendanceStatus | null;
  markedByTeacher: boolean;
  markedAt: Date | null;
}

// A guest checked in with no Member record — always PRESENT (checkInFirstTimer
// only ever creates a present attendance row), so no `status` field to mirror
// SessionRosterEntry's nullable one.
export interface SessionRosterFirstTimerEntry {
  attendanceId: string;
  firstTimerId: string;
  name: string;
  markedAt: Date;
}

export interface SessionRoster {
  sessionId: string;
  classId: string;
  sessionDate: string;
  selfMarkOpen: boolean;
  selfMarkClosesAt: Date | null;
  firstTimerCheckIns: SessionRosterFirstTimerEntry[];
  members: SessionRosterEntry[];
}

@Injectable()
export class SundaySchoolService {
  private readonly logger = new Logger(SundaySchoolService.name);

  constructor(
    @InjectRepository(SundaySchoolClass)
    private readonly classRepo: Repository<SundaySchoolClass>,
    @InjectRepository(SundaySchoolMember)
    private readonly memberAssignRepo: Repository<SundaySchoolMember>,
    @InjectRepository(SundaySchoolSession)
    private readonly sessionRepo: Repository<SundaySchoolSession>,
    @InjectRepository(SundaySchoolAttendance)
    private readonly attendanceRepo: Repository<SundaySchoolAttendance>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    @InjectRepository(SundaySchoolQuestion)
    private readonly questionRepo: Repository<SundaySchoolQuestion>,
    private readonly departmentAccessService: DepartmentAccessService,
    private readonly notificationDispatchService: NotificationDispatchService,
    private readonly followUpService: FollowUpService,
  ) {}

  async createClass(
    user: MemberAuth,
    dto: CreateSundaySchoolClassDto,
  ): Promise<SundaySchoolClass & { membersCount: number }> {
    await this.requireSundaySchoolAuth(user);
    if (dto.teacherId) await this.assertMemberExists(dto.teacherId);
    this.logger.log(`Creating Sunday School class: ${dto.name}`);
    const entity = this.classRepo.create({
      name: dto.name,
      description: dto.description ?? null,
      teacher: dto.teacherId ? { id: dto.teacherId } : null,
    });
    const saved = await this.classRepo.save(entity);
    return { ...saved, membersCount: 0 };
  }

  async updateClass(
    user: MemberAuth,
    id: string,
    dto: UpdateSundaySchoolClassDto,
  ): Promise<SundaySchoolClass & { membersCount: number }> {
    await this.requireSundaySchoolAuth(user, id);
    if (dto.teacherId) await this.assertMemberExists(dto.teacherId);
    this.logger.log(`Updating Sunday School class ${id}`);
    const entity = await this.classRepo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException('Sunday School class not found');
    if (dto.name !== undefined) entity.name = dto.name;
    if (dto.description !== undefined)
      entity.description = dto.description ?? null;
    if (dto.teacherId !== undefined) {
      entity.teacher = dto.teacherId ? ({ id: dto.teacherId } as Member) : null;
    }
    const saved = await this.classRepo.save(entity);
    return (await this.attachMembersCount([saved]))[0];
  }

  async deleteClass(id: string): Promise<void> {
    this.logger.log(`Deleting Sunday School class ${id}`);
    const entity = await this.classRepo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException('Sunday School class not found');

    const [memberCount, sessionCount] = await Promise.all([
      this.memberAssignRepo.count({ where: { sundaySchoolClass: { id } } }),
      this.sessionRepo.count({ where: { sundaySchoolClass: { id } } }),
    ]);
    if (memberCount > 0) {
      throw new BadRequestException(
        `Cannot delete this class — ${memberCount} member(s) are assigned. Remove them first.`,
      );
    }
    if (sessionCount > 0) {
      throw new BadRequestException(
        `Cannot delete this class — ${sessionCount} session(s) have been recorded. Delete all sessions first.`,
      );
    }

    await this.classRepo.remove(entity);
  }

  async getAllClasses(
    page = 1,
    limit = 20,
  ): Promise<
    PaginationResponseDto<SundaySchoolClass & { membersCount: number }>
  > {
    const [data, totalCount] = await this.classRepo.findAndCount({
      relations: ['teacher'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      data: await this.attachMembersCount(data),
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async getClass(id: string): Promise<SundaySchoolClass> {
    const entity = await this.classRepo.findOne({
      where: { id },
      relations: ['teacher'],
    });
    if (!entity) throw new NotFoundException('Sunday School class not found');
    return entity;
  }

  async assignMember(
    user: MemberAuth,
    classId: string,
    dto: AssignSundaySchoolMemberDto,
  ): Promise<SundaySchoolMember> {
    await this.requireSundaySchoolAuth(user, classId);
    this.logger.log(
      `Assigning member ${dto.memberId} to Sunday School class ${classId}`,
    );
    const cls = await this.classRepo.findOne({ where: { id: classId } });
    if (!cls) throw new NotFoundException('Sunday School class not found');
    const memberExists = await this.memberRepo.existsBy({ id: dto.memberId });
    if (!memberExists) throw new NotFoundException('Member not found');
    const existing = await this.memberAssignRepo.findOne({
      where: {
        member: { id: dto.memberId },
        sundaySchoolClass: { id: classId },
      },
    });
    if (existing)
      throw new BadRequestException(
        'This member is already assigned to this Sunday School class.',
      );
    const assignment = this.memberAssignRepo.create({
      member: { id: dto.memberId } as Member,
      sundaySchoolClass: cls,
    });
    return this.memberAssignRepo.save(assignment);
  }

  async removeMember(
    user: MemberAuth,
    classId: string,
    memberId: string,
  ): Promise<void> {
    await this.requireSundaySchoolAuth(user, classId);
    this.logger.log(
      `Removing member ${memberId} from Sunday School class ${classId}`,
    );
    const assignment = await this.memberAssignRepo.findOne({
      where: { member: { id: memberId }, sundaySchoolClass: { id: classId } },
    });
    if (!assignment)
      throw new NotFoundException(
        'This member is not assigned to this Sunday School class.',
      );
    await this.memberAssignRepo.remove(assignment);
  }

  async getClassMembers(
    classId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginationResponseDto<SundaySchoolMember>> {
    const cls = await this.classRepo.findOne({ where: { id: classId } });
    if (!cls) throw new NotFoundException('Sunday School class not found');
    const [data, totalCount] = await this.memberAssignRepo.findAndCount({
      where: { sundaySchoolClass: { id: classId } },
      relations: ['member'],
      order: { assignedAt: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      data,
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async getSessionsForClass(
    user: MemberAuth,
    classId: string,
    page = 1,
    limit = 20,
  ): Promise<
    PaginationResponseDto<SundaySchoolSession & { selfMarkOpen: boolean }>
  > {
    const cls = await this.classRepo.findOne({ where: { id: classId } });
    if (!cls) throw new NotFoundException('Sunday School class not found');
    await this.requireSundaySchoolAuth(user, classId);
    const [data, totalCount] = await this.sessionRepo.findAndCount({
      where: { sundaySchoolClass: { id: classId } },
      order: { sessionDate: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      data: data.map((s) => this.withSelfMarkOpen(s)),
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async getSession(
    user: MemberAuth,
    sessionId: string,
  ): Promise<SundaySchoolSession & { selfMarkOpen: boolean }> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
      relations: ['sundaySchoolClass'],
    });
    if (!session) throw new NotFoundException('Session not found');
    await this.requireSundaySchoolAuth(user, session.sundaySchoolClass.id);
    return this.withSelfMarkOpen(session);
  }

  async deleteSession(user: MemberAuth, sessionId: string): Promise<void> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
      relations: ['sundaySchoolClass'],
    });
    if (!session) throw new NotFoundException('Session not found');
    await this.requireSundaySchoolAuth(user, session.sundaySchoolClass.id);

    const attendanceCount = await this.attendanceRepo.count({
      where: { session: { id: sessionId } },
    });
    if (attendanceCount > 0) {
      throw new BadRequestException(
        `Cannot delete this session — ${attendanceCount} attendance record(s) exist. Sessions with attendance cannot be deleted.`,
      );
    }

    this.logger.log(
      `Deleting session ${sessionId} for class ${session.sundaySchoolClass.id}`,
    );
    await this.sessionRepo.remove(session);
  }

  async createSession(
    user: MemberAuth,
    dto: CreateSundaySchoolSessionDto,
  ): Promise<SundaySchoolSession & { selfMarkOpen: boolean }> {
    await this.requireSundaySchoolAuth(user, dto.classId);
    this.logger.log(
      `Creating session for class ${dto.classId} on ${dto.sessionDate}`,
    );
    const cls = await this.classRepo.findOne({ where: { id: dto.classId } });
    if (!cls) throw new NotFoundException('Sunday School class not found');
    const existing = await this.sessionRepo.findOne({
      where: {
        sundaySchoolClass: { id: dto.classId },
        sessionDate: dto.sessionDate,
      },
    });
    if (existing)
      throw new BadRequestException(
        'A session already exists for this class on the selected date.',
      );
    const session = this.sessionRepo.create({
      sundaySchoolClass: cls,
      sessionDate: dto.sessionDate,
      notes: dto.notes ?? null,
      documentUrl: dto.documentUrl ?? null,
    });
    const saved = await this.saveNewSession(session);
    return this.withSelfMarkOpen(saved);
  }

  async openSelfMark(
    user: MemberAuth,
    sessionId: string,
    closesInMinutes: number,
  ): Promise<SundaySchoolSession & { selfMarkOpen: boolean }> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
      relations: ['sundaySchoolClass'],
    });
    if (!session) throw new NotFoundException('Session not found');
    await this.requireSundaySchoolAuth(user, session.sundaySchoolClass.id);
    this.logger.log(
      `Opening self-mark for session ${sessionId} for ${closesInMinutes} minutes`,
    );
    const closesAt = new Date();
    closesAt.setMinutes(closesAt.getMinutes() + closesInMinutes);
    session.selfMarkClosesAt = closesAt;
    const saved = await this.sessionRepo.save(session);
    return this.withSelfMarkOpen(saved);
  }

  async closeSelfMark(
    user: MemberAuth,
    sessionId: string,
  ): Promise<SundaySchoolSession & { selfMarkOpen: boolean }> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
      relations: ['sundaySchoolClass'],
    });
    if (!session) throw new NotFoundException('Session not found');
    await this.requireSundaySchoolAuth(user, session.sundaySchoolClass.id);
    this.logger.log(`Closing self-mark for session ${sessionId}`);
    session.selfMarkClosesAt = null;
    const saved = await this.sessionRepo.save(session);
    return this.withSelfMarkOpen(saved);
  }

  async selfMarkPresent(
    user: MemberAuth,
    sessionId: string,
  ): Promise<SundaySchoolAttendance> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
      relations: ['sundaySchoolClass'],
    });
    if (!session) throw new NotFoundException('Session not found');
    if (!session.selfMarkClosesAt || session.selfMarkClosesAt <= new Date()) {
      throw new BadRequestException(
        'Self-marking attendance is not currently open for this session.',
      );
    }
    const assignment = await this.memberAssignRepo.findOne({
      where: {
        member: { id: user.id },
        sundaySchoolClass: { id: session.sundaySchoolClass.id },
      },
    });
    if (!assignment)
      throw new ForbiddenException(
        'You are not assigned to this Sunday School class',
      );
    const existing = await this.attendanceRepo.findOne({
      where: { session: { id: sessionId }, member: { id: user.id } },
    });
    if (existing) {
      if (existing.status === SundaySchoolAttendanceStatus.PRESENT) {
        throw new BadRequestException(
          'You have already marked attendance for this session',
        );
      }
      existing.status = SundaySchoolAttendanceStatus.PRESENT;
      existing.markedByTeacher = false;
      existing.markedAt = new Date();
      return this.attendanceRepo.save(existing);
    }
    const attendance = this.attendanceRepo.create({
      session: { id: sessionId } as SundaySchoolSession,
      member: { id: user.id } as Member,
      status: SundaySchoolAttendanceStatus.PRESENT,
      markedByTeacher: false,
    });
    return this.attendanceRepo.save(attendance);
  }

  async getMyAttendanceHistory(
    user: MemberAuth,
    page: number,
    limit: number,
  ): Promise<PaginationResponseDto<SundaySchoolAttendance>> {
    const [data, totalCount] = await this.attendanceRepo.findAndCount({
      where: { member: { id: user.id } },
      relations: ['session', 'session.sundaySchoolClass'],
      order: { markedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      data,
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  // `alreadyCheckedIn` is a per-member computed field, not on the entity
  // itself — a session stays "open" (selfMarkClosesAt in the future) for
  // every member in the class regardless of whether THIS member has already
  // self-marked PRESENT for it, so the member app can't tell them apart
  // without this. Without it, a member who checks in and later re-opens the
  // tab (or the periodic refetch fires again) sees the exact same session
  // looking freshly actionable, and a second tap throws (selfMarkPresent()
  // rejects a duplicate PRESENT mark) instead of the button simply already
  // reading "Checked In".
  async getOpenSessionsForMember(
    user: MemberAuth,
  ): Promise<(SundaySchoolSession & { alreadyCheckedIn: boolean })[]> {
    const assignments = await this.memberAssignRepo.find({
      where: { member: { id: user.id } },
      relations: ['sundaySchoolClass'],
    });
    if (assignments.length === 0) return [];
    const classIds = assignments.map((a) => a.sundaySchoolClass.id);
    const sessions = await this.sessionRepo.find({
      where: {
        sundaySchoolClass: { id: In(classIds) },
        selfMarkClosesAt: MoreThan(new Date()),
      },
      relations: ['sundaySchoolClass'],
    });
    if (sessions.length === 0) return [];

    const presentAttendances = await this.attendanceRepo.find({
      where: {
        session: { id: In(sessions.map((s) => s.id)) },
        member: { id: user.id },
        status: SundaySchoolAttendanceStatus.PRESENT,
      },
      relations: ['session'],
    });
    const presentSessionIds = new Set(
      presentAttendances.map((a) => a.session.id),
    );

    return sessions.map((session) => ({
      ...session,
      alreadyCheckedIn: presentSessionIds.has(session.id),
    }));
  }

  async bulkMarkAttendance(
    user: MemberAuth,
    sessionId: string,
    dto: BulkMarkAttendanceDto,
  ): Promise<SundaySchoolAttendance[]> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
      relations: ['sundaySchoolClass'],
    });
    if (!session) throw new NotFoundException('Session not found');
    await this.requireSundaySchoolAuth(user, session.sundaySchoolClass.id);
    this.logger.log(`Bulk marking attendance for session ${sessionId}`);

    const memberIds = dto.attendances.map((e) => e.memberId);

    if (memberIds.length === 0) {
      this.logger.log(`No attendance entries to mark for session ${sessionId}`);
      return [];
    }

    // Use transaction for data consistency
    return this.attendanceRepo.manager.transaction(
      async (transactionalEntityManager) => {
        // 1 query: which submitted members are actually assigned to this class
        const validAssignments = await transactionalEntityManager.find(
          SundaySchoolMember,
          {
            where: {
              sundaySchoolClass: { id: session.sundaySchoolClass.id },
              member: { id: In(memberIds) },
            },
            relations: ['member'],
          },
        );
        const validIds = new Set(validAssignments.map((a) => a.member.id));

        // 1 query: existing attendance records for this session
        const existing = await transactionalEntityManager.find(
          SundaySchoolAttendance,
          {
            where: {
              session: { id: sessionId },
              member: { id: In(memberIds) },
            },
            relations: ['member'],
          },
        );
        const existingMap = new Map(existing.map((a) => [a.member.id, a]));

        const toSave: SundaySchoolAttendance[] = [];
        for (const entry of dto.attendances) {
          if (!validIds.has(entry.memberId)) continue;
          const record = existingMap.get(entry.memberId);
          if (record) {
            record.status = entry.status;
            record.markedByTeacher = true;
            record.markedAt = new Date();
            toSave.push(record);
          } else {
            toSave.push(
              this.attendanceRepo.create({
                session: { id: sessionId } as SundaySchoolSession,
                member: { id: entry.memberId } as Member,
                status: entry.status,
                markedByTeacher: true,
              }),
            );
          }
        }

        // 1 batch save instead of N individual saves
        if (toSave.length > 0) {
          const result = await transactionalEntityManager.save(
            SundaySchoolAttendance,
            toSave,
          );
          this.logger.log(
            `Successfully marked ${result.length} attendance records for session ${sessionId}`,
          );
          return result;
        }
        return [];
      },
    );
  }

  // Creates a real FirstTimer (triggering the normal follow-up task/
  // notification) and marks them present for this session in one step —
  // for a teacher checking in someone with no Member record at all,
  // typically a visiting child/family with no prior church contact.
  // Deliberately NOT nested inside a manually-opened transaction the way
  // bulkMarkAttendance is: createFirstTimerFromSundaySchoolCheckIn relies
  // on the CLS-ambient transaction (this.txHost.tx) FollowUpService itself
  // manages, which would conflict with a second, independently-opened
  // `this.attendanceRepo.manager.transaction()` around it.
  async checkInFirstTimer(
    user: MemberAuth,
    sessionId: string,
    dto: CheckInFirstTimerDto,
  ): Promise<SundaySchoolAttendance> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
      relations: ['sundaySchoolClass'],
    });
    if (!session) throw new NotFoundException('Session not found');
    await this.requireSundaySchoolAuth(user, session.sundaySchoolClass.id);

    const firstTimer =
      await this.followUpService.createFirstTimerFromSundaySchoolCheckIn(
        {
          firstname: dto.firstname,
          lastname: dto.lastname,
          phone: dto.phone,
          notes: dto.notes,
        },
        user.id,
      );

    const attendance = this.attendanceRepo.create({
      session: { id: sessionId } as SundaySchoolSession,
      firstTimer,
      status: SundaySchoolAttendanceStatus.PRESENT,
      markedByTeacher: true,
    });
    const saved = await this.attendanceRepo.save(attendance);
    this.logger.log(
      `Checked in first-timer ${firstTimer.id} for session ${sessionId}`,
    );
    return { ...saved, firstTimer };
  }

  async getSessionRoster(
    user: MemberAuth,
    sessionId: string,
  ): Promise<SessionRoster> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
      relations: ['sundaySchoolClass'],
    });
    if (!session) throw new NotFoundException('Session not found');
    await this.requireSundaySchoolAuth(user, session.sundaySchoolClass.id);

    const [classMembers, attendances] = await Promise.all([
      this.memberAssignRepo.find({
        where: { sundaySchoolClass: { id: session.sundaySchoolClass.id } },
        relations: ['member'],
      }),
      this.attendanceRepo.find({
        where: { session: { id: sessionId } },
        relations: ['member', 'firstTimer'],
      }),
    ]);

    // Every row has exactly one of member/firstTimer (DB-enforced) — split
    // by which, rather than assuming `a.member` is always set as the code
    // did before first-timer check-ins existed (that crashed on any guest
    // row: `a.member.id` on a null member).
    const memberAttendances = attendances.filter((a) => a.member);
    const firstTimerAttendances = attendances.filter((a) => a.firstTimer);
    const attendanceMap = new Map(
      memberAttendances.map((a) => [a.member!.id, a]),
    );

    return {
      sessionId,
      classId: session.sundaySchoolClass.id,
      sessionDate: session.sessionDate,
      selfMarkOpen:
        !!session.selfMarkClosesAt &&
        new Date() < new Date(session.selfMarkClosesAt),
      selfMarkClosesAt: session.selfMarkClosesAt,
      members: classMembers.map((cm) => {
        const att = attendanceMap.get(cm.member.id);
        return {
          memberId: cm.member.id,
          name: `${cm.member.firstname} ${cm.member.lastname}`,
          status: att?.status ?? null,
          markedByTeacher: att?.markedByTeacher ?? false,
          markedAt: att?.markedAt ?? null,
        };
      }),
      firstTimerCheckIns: firstTimerAttendances.map((a) => ({
        attendanceId: a.id,
        firstTimerId: a.firstTimer!.id,
        name: `${a.firstTimer!.firstname} ${a.firstTimer!.lastname}`,
        markedAt: a.markedAt,
      })),
    };
  }

  // ─── Questions (Q&A) ──────────────────────────────────────────────────────

  async getMyClasses(user: MemberAuth): Promise<SundaySchoolClass[]> {
    const assignments = await this.memberAssignRepo.find({
      where: { member: { id: user.id } },
      relations: ['sundaySchoolClass'],
    });
    return assignments.map((a) => a.sundaySchoolClass);
  }

  async askQuestion(
    user: MemberAuth,
    classId: string,
    dto: AskQuestionDto,
  ): Promise<SundaySchoolQuestion> {
    const cls = await this.classRepo.findOne({
      where: { id: classId },
      relations: ['teacher'],
    });
    if (!cls) throw new NotFoundException('Sunday School class not found');
    const assignment = await this.memberAssignRepo.findOne({
      where: { member: { id: user.id }, sundaySchoolClass: { id: classId } },
    });
    if (!assignment)
      throw new ForbiddenException(
        'You are not assigned to this Sunday School class',
      );

    const question = this.questionRepo.create({
      sundaySchoolClass: cls,
      askedBy: { id: user.id } as Member,
      questionText: dto.questionText,
    });
    const saved = await this.questionRepo.save(question);

    const asker = await this.memberRepo.findOne({ where: { id: user.id } });
    await this.notifyOnQuestionAsked(cls, asker);

    return saved;
  }

  // A class with an assigned teacher notifies just them (email + push) —
  // they're the direct owner. A class with no assigned teacher falls back
  // to every Sunday-School-capability worker (push only — an inbox hit for
  // the whole team on every question in an unusual, teacherless class isn't
  // worth it) rather than the question landing with nobody notified at all.
  private async notifyOnQuestionAsked(
    cls: SundaySchoolClass,
    asker: Member | null,
  ): Promise<void> {
    const askerName = asker
      ? `${asker.firstname} ${asker.lastname}`
      : 'A student';
    if (cls.teacher) {
      const teacher = await this.memberRepo.findOne({
        where: { id: cls.teacher.id },
      });
      if (!teacher) return;
      await this.notificationDispatchService.notifyMember({
        category: EmailCategory.SUNDAY_SCHOOL_QA,
        email: {
          to: teacher.email,
          subject: `New question in ${cls.name}`,
          template: 'sunday-school-question-asked',
          data: { name: teacher.firstname, className: cls.name, askerName },
        },
        push: {
          memberIds: [teacher.id],
          title: 'New Sunday School Question',
          body: `${askerName} asked a question in ${cls.name}.`,
          url: '/sunday-school',
          idempotencyKey: `sunday-school-question-asked:${cls.id}:${Date.now()}`,
        },
      });
      return;
    }

    const staffIds =
      await this.departmentAccessService.findMemberIdsWithCapability(
        DepartmentCapability.MANAGE_SUNDAY_SCHOOL,
      );
    if (staffIds.length === 0) return;
    await this.notificationDispatchService.notifyMember({
      category: EmailCategory.SUNDAY_SCHOOL_QA,
      push: {
        memberIds: staffIds,
        title: 'New Sunday School Question',
        body: `${askerName} asked a question in ${cls.name} (no teacher assigned).`,
        url: '/sunday-school',
        idempotencyKey: `sunday-school-question-asked:${cls.id}:${Date.now()}`,
      },
    });
  }

  async getMyQuestions(
    user: MemberAuth,
    page = 1,
    limit = 20,
  ): Promise<PaginationResponseDto<SundaySchoolQuestion>> {
    const [data, totalCount] = await this.questionRepo.findAndCount({
      where: { askedBy: { id: user.id } },
      relations: ['sundaySchoolClass'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      data,
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async getQuestionsForClass(
    user: MemberAuth,
    classId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginationResponseDto<SundaySchoolQuestion>> {
    const cls = await this.classRepo.findOne({ where: { id: classId } });
    if (!cls) throw new NotFoundException('Sunday School class not found');
    await this.requireSundaySchoolAuth(user, classId);
    const [data, totalCount] = await this.questionRepo.findAndCount({
      where: { sundaySchoolClass: { id: classId } },
      relations: ['askedBy'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      data,
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  // Cross-class view for SS staff — the per-class list above requires
  // opening one class at a time to see its questions, which doesn't scale
  // to "what's been asked across all my classes" for a team of teachers.
  // Gated on the department capability only (not the requireSundaySchoolAuth
  // teacher fallback) — a class-specific teacher who isn't in the SS
  // department shouldn't see every other class's private Q&A, only their
  // own via getQuestionsForClass.
  async getAllQuestions(
    user: MemberAuth,
    page = 1,
    limit = 20,
  ): Promise<PaginationResponseDto<SundaySchoolQuestion>> {
    await this.departmentAccessService.assertHasCapability(
      user.id,
      DepartmentCapability.MANAGE_SUNDAY_SCHOOL,
      'Only Sunday School staff can view questions across all classes.',
    );
    return this.queryAllQuestions(page, limit);
  }

  async adminGetAllQuestions(
    page = 1,
    limit = 20,
  ): Promise<PaginationResponseDto<SundaySchoolQuestion>> {
    return this.queryAllQuestions(page, limit);
  }

  private async queryAllQuestions(
    page: number,
    limit: number,
  ): Promise<PaginationResponseDto<SundaySchoolQuestion>> {
    const [data, totalCount] = await this.questionRepo.findAndCount({
      relations: ['askedBy', 'sundaySchoolClass'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      data,
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async answerQuestion(
    user: MemberAuth,
    questionId: string,
    dto: AnswerQuestionDto,
  ): Promise<SundaySchoolQuestion> {
    const question = await this.questionRepo.findOne({
      where: { id: questionId },
      relations: ['sundaySchoolClass', 'askedBy'],
    });
    if (!question) throw new NotFoundException('Question not found');
    await this.requireSundaySchoolAuth(user, question.sundaySchoolClass.id);
    return this.applyAnswer(question, dto, user.id);
  }

  private async applyAnswer(
    question: SundaySchoolQuestion,
    dto: AnswerQuestionDto,
    answererId: string,
  ): Promise<SundaySchoolQuestion> {
    question.answerText = dto.answerText;
    question.answeredBy = { id: answererId } as Member;
    question.answeredAt = new Date();
    const saved = await this.questionRepo.save(question);

    await this.notificationDispatchService.notifyMember({
      category: EmailCategory.SUNDAY_SCHOOL_QA,
      email: {
        to: question.askedBy.email,
        subject: `Your question in ${question.sundaySchoolClass.name} was answered`,
        template: 'sunday-school-question-answered',
        data: {
          name: question.askedBy.firstname,
          className: question.sundaySchoolClass.name,
          questionText: question.questionText,
          answerText: dto.answerText,
        },
      },
      push: {
        memberIds: [question.askedBy.id],
        title: 'Your Question Was Answered',
        body: `Your question in ${question.sundaySchoolClass.name} has been answered.`,
        url: '/sunday-school',
        idempotencyKey: `sunday-school-question-answered:${saved.id}`,
      },
    });

    return saved;
  }

  // ─── Admin Methods (bypass worker auth) ──────────────────────────────────

  async adminCreateClass(
    dto: CreateSundaySchoolClassDto,
  ): Promise<SundaySchoolClass & { membersCount: number }> {
    if (dto.teacherId) await this.assertMemberExists(dto.teacherId);
    const entity = this.classRepo.create({
      name: dto.name,
      description: dto.description ?? null,
      teacher: dto.teacherId ? { id: dto.teacherId } : null,
    });
    const saved = await this.classRepo.save(entity);
    return { ...saved, membersCount: 0 };
  }

  async adminUpdateClass(
    id: string,
    dto: UpdateSundaySchoolClassDto,
  ): Promise<SundaySchoolClass & { membersCount: number }> {
    if (dto.teacherId) await this.assertMemberExists(dto.teacherId);
    const entity = await this.classRepo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException('Sunday School class not found');
    if (dto.name !== undefined) entity.name = dto.name;
    if (dto.description !== undefined)
      entity.description = dto.description ?? null;
    if (dto.teacherId !== undefined) {
      entity.teacher = dto.teacherId ? ({ id: dto.teacherId } as Member) : null;
    }
    const saved = await this.classRepo.save(entity);
    return (await this.attachMembersCount([saved]))[0];
  }

  async adminAssignMember(
    classId: string,
    memberId: string,
  ): Promise<SundaySchoolMember> {
    const cls = await this.classRepo.findOne({ where: { id: classId } });
    if (!cls) throw new NotFoundException('Sunday School class not found');
    const memberExists = await this.memberRepo.existsBy({ id: memberId });
    if (!memberExists) throw new NotFoundException('Member not found');
    const existing = await this.memberAssignRepo.findOne({
      where: { member: { id: memberId }, sundaySchoolClass: { id: classId } },
    });
    if (existing)
      throw new BadRequestException(
        'This member is already assigned to this Sunday School class.',
      );
    const assignment = this.memberAssignRepo.create({
      member: { id: memberId } as Member,
      sundaySchoolClass: cls,
    });
    return this.memberAssignRepo.save(assignment);
  }

  async adminRemoveMember(classId: string, memberId: string): Promise<void> {
    const assignment = await this.memberAssignRepo.findOne({
      where: { member: { id: memberId }, sundaySchoolClass: { id: classId } },
    });
    if (!assignment)
      throw new NotFoundException(
        'This member is not assigned to this Sunday School class.',
      );
    await this.memberAssignRepo.remove(assignment);
  }

  async adminGetSessions(
    classId: string,
    page = 1,
    limit = 20,
  ): Promise<
    PaginationResponseDto<SundaySchoolSession & { selfMarkOpen: boolean }>
  > {
    const cls = await this.classRepo.findOne({ where: { id: classId } });
    if (!cls) throw new NotFoundException('Sunday School class not found');
    const [data, totalCount] = await this.sessionRepo.findAndCount({
      where: { sundaySchoolClass: { id: classId } },
      order: { sessionDate: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      data: data.map((s) => this.withSelfMarkOpen(s)),
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async adminCreateSession(
    dto: CreateSundaySchoolSessionDto,
  ): Promise<SundaySchoolSession & { selfMarkOpen: boolean }> {
    const cls = await this.classRepo.findOne({ where: { id: dto.classId } });
    if (!cls) throw new NotFoundException('Sunday School class not found');
    const existing = await this.sessionRepo.findOne({
      where: {
        sundaySchoolClass: { id: dto.classId },
        sessionDate: dto.sessionDate,
      },
    });
    if (existing)
      throw new BadRequestException(
        'A session already exists for this class on the selected date.',
      );
    const session = this.sessionRepo.create({
      sundaySchoolClass: cls,
      sessionDate: dto.sessionDate,
      notes: dto.notes ?? null,
      documentUrl: dto.documentUrl ?? null,
    });
    const saved = await this.saveNewSession(session);
    return this.withSelfMarkOpen(saved);
  }

  async adminDeleteSession(sessionId: string): Promise<void> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Session not found');

    const attendanceCount = await this.attendanceRepo.count({
      where: { session: { id: sessionId } },
    });
    if (attendanceCount > 0) {
      throw new BadRequestException(
        `Cannot delete this session — ${attendanceCount} attendance record(s) exist. Sessions with attendance cannot be deleted.`,
      );
    }

    await this.sessionRepo.remove(session);
  }

  async adminOpenSession(
    sessionId: string,
    closesInMinutes: number,
  ): Promise<SundaySchoolSession & { selfMarkOpen: boolean }> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Session not found');
    const closesAt = new Date();
    closesAt.setMinutes(closesAt.getMinutes() + closesInMinutes);
    session.selfMarkClosesAt = closesAt;
    const saved = await this.sessionRepo.save(session);
    return this.withSelfMarkOpen(saved);
  }

  async adminCloseSession(
    sessionId: string,
  ): Promise<SundaySchoolSession & { selfMarkOpen: boolean }> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Session not found');
    session.selfMarkClosesAt = null;
    const saved = await this.sessionRepo.save(session);
    return this.withSelfMarkOpen(saved);
  }

  async adminBulkMarkAttendance(
    sessionId: string,
    dto: BulkMarkAttendanceDto,
  ): Promise<{ marked: number }> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
      relations: ['sundaySchoolClass'],
    });
    if (!session) throw new NotFoundException('Session not found');
    const memberIds = dto.attendances.map((e) => e.memberId);
    if (memberIds.length === 0) return { marked: 0 };

    const result = await this.attendanceRepo.manager.transaction(async (em) => {
      const validAssignments = await em.find(SundaySchoolMember, {
        where: {
          sundaySchoolClass: { id: session.sundaySchoolClass.id },
          member: { id: In(memberIds) },
        },
        relations: ['member'],
      });
      const validIds = new Set(validAssignments.map((a) => a.member.id));
      const existing = await em.find(SundaySchoolAttendance, {
        where: { session: { id: sessionId }, member: { id: In(memberIds) } },
        relations: ['member'],
      });
      const existingMap = new Map(existing.map((a) => [a.member.id, a]));
      const toSave: SundaySchoolAttendance[] = [];
      for (const entry of dto.attendances) {
        if (!validIds.has(entry.memberId)) continue;
        const record = existingMap.get(entry.memberId);
        if (record) {
          record.status = entry.status;
          record.markedByTeacher = true;
          record.markedAt = new Date();
          toSave.push(record);
        } else {
          toSave.push(
            this.attendanceRepo.create({
              session: { id: sessionId } as SundaySchoolSession,
              member: { id: entry.memberId } as Member,
              status: entry.status,
              markedByTeacher: true,
            }),
          );
        }
      }
      return toSave.length > 0
        ? await em.save(SundaySchoolAttendance, toSave)
        : [];
    });
    return { marked: result.length };
  }

  async adminGetSessionRoster(sessionId: string): Promise<SessionRoster> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
      relations: ['sundaySchoolClass'],
    });
    if (!session) throw new NotFoundException('Session not found');
    const [classMembers, attendances] = await Promise.all([
      this.memberAssignRepo.find({
        where: { sundaySchoolClass: { id: session.sundaySchoolClass.id } },
        relations: ['member'],
      }),
      this.attendanceRepo.find({
        where: { session: { id: sessionId } },
        relations: ['member', 'firstTimer'],
      }),
    ]);
    const memberAttendances = attendances.filter((a) => a.member);
    const firstTimerAttendances = attendances.filter((a) => a.firstTimer);
    const attendanceMap = new Map(
      memberAttendances.map((a) => [a.member!.id, a]),
    );
    return {
      sessionId,
      classId: session.sundaySchoolClass.id,
      sessionDate: session.sessionDate,
      selfMarkOpen:
        !!session.selfMarkClosesAt &&
        new Date() < new Date(session.selfMarkClosesAt),
      selfMarkClosesAt: session.selfMarkClosesAt,
      members: classMembers.map((cm) => {
        const att = attendanceMap.get(cm.member.id);
        return {
          memberId: cm.member.id,
          name: `${cm.member.firstname} ${cm.member.lastname}`,
          status: att?.status ?? null,
          markedByTeacher: att?.markedByTeacher ?? false,
          markedAt: att?.markedAt ?? null,
        };
      }),
      firstTimerCheckIns: firstTimerAttendances.map((a) => ({
        attendanceId: a.id,
        firstTimerId: a.firstTimer!.id,
        name: `${a.firstTimer!.firstname} ${a.firstTimer!.lastname}`,
        markedAt: a.markedAt,
      })),
    };
  }

  async adminGetQuestionsForClass(
    classId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginationResponseDto<SundaySchoolQuestion>> {
    const cls = await this.classRepo.findOne({ where: { id: classId } });
    if (!cls) throw new NotFoundException('Sunday School class not found');
    const [data, totalCount] = await this.questionRepo.findAndCount({
      where: { sundaySchoolClass: { id: classId } },
      relations: ['askedBy'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      data,
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async adminAnswerQuestion(
    questionId: string,
    dto: AnswerQuestionDto,
    answererId: string,
  ): Promise<SundaySchoolQuestion> {
    const question = await this.questionRepo.findOne({
      where: { id: questionId },
      relations: ['sundaySchoolClass', 'askedBy'],
    });
    if (!question) throw new NotFoundException('Question not found');
    return this.applyAnswer(question, dto, answererId);
  }

  async adminDeleteQuestion(questionId: string): Promise<void> {
    const question = await this.questionRepo.findOne({
      where: { id: questionId },
    });
    if (!question) throw new NotFoundException('Question not found');
    await this.questionRepo.remove(question);
  }

  // ─── Response Shaping Helpers ─────────────────────────────────────────────

  private withSelfMarkOpen<T extends SundaySchoolSession>(
    session: T,
  ): T & { selfMarkOpen: boolean } {
    return {
      ...session,
      selfMarkOpen:
        !!session.selfMarkClosesAt &&
        new Date() < new Date(session.selfMarkClosesAt),
    };
  }

  private async attachMembersCount<T extends SundaySchoolClass>(
    classes: T[],
  ): Promise<(T & { membersCount: number })[]> {
    if (classes.length === 0) return [];
    const counts = await this.memberAssignRepo
      .createQueryBuilder('m')
      .innerJoin('m.sundaySchoolClass', 'c')
      .select('c.id', 'classId')
      .addSelect('COUNT(*)', 'count')
      .where('c.id IN (:...ids)', { ids: classes.map((c) => c.id) })
      .groupBy('c.id')
      .getRawMany<{ classId: string; count: string }>();
    const countMap = new Map(
      counts.map((row) => [row.classId, parseInt(row.count, 10)]),
    );
    return classes.map((c) => ({
      ...c,
      membersCount: countMap.get(c.id) ?? 0,
    }));
  }

  private async assertMemberExists(memberId: string): Promise<void> {
    const exists = await this.memberRepo.existsBy({ id: memberId });
    if (!exists) throw new NotFoundException('Teacher not found');
  }

  // The pre-check in createSession/adminCreateSession has no row lock, so
  // two concurrent creates for the same class+date can both pass it — the
  // sunday_school_sessions unique constraint on (class, date) is the real
  // backstop. Without this catch the loser gets a raw 23505 error instead
  // of the same friendly "already exists" message the pre-check gives.
  private async saveNewSession(
    session: SundaySchoolSession,
  ): Promise<SundaySchoolSession> {
    try {
      return await this.sessionRepo.save(session);
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err as any).driverError?.code === '23505'
      ) {
        throw new ConflictException(
          'A session already exists for this class on the selected date.',
        );
      }
      throw err;
    }
  }

  // ─── Authorization Helpers ────────────────────────────────────────────────

  /**
   * Grants access to:
   * - Workers in a department whose key is SUNDAY_SCHOOL (primary or secondary)
   * - The appointed teacher of a specific class (when classId is provided)
   *
   * Workers from other departments can therefore be empowered by being appointed
   * as teacher on a specific class without needing to transfer departments.
   */
  private async requireSundaySchoolAuth(
    user: MemberAuth,
    classId?: string,
  ): Promise<void> {
    if (
      await this.departmentAccessService.hasCapability(
        user.id,
        DepartmentCapability.MANAGE_SUNDAY_SCHOOL,
      )
    )
      return;

    if (classId && (await this.isClassTeacher(user.id, classId))) return;

    throw new ForbiddenException(
      'Only Sunday School staff or the appointed class teacher are authorized to perform this action.',
    );
  }

  private async isClassTeacher(
    memberId: string,
    classId: string,
  ): Promise<boolean> {
    const cls = await this.classRepo.findOne({
      where: { id: classId, teacher: { id: memberId } },
    });
    return !!cls;
  }
}
