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
import { SundaySchoolSettingsService } from './sunday-school-settings.service';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
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
import {
  CreateSundaySchoolSessionDto,
  CreateSundaySchoolSessionSeriesDto,
  UpdateSundaySchoolSessionDto,
} from '../dto/create-sunday-school-session.dto';
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
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';
import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';
import { addDays, todayInChurchTz } from '../util/church-date';

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
  // Teacher view only: whether teachers can still mark this session, and the last day they can.
  teacherMarkingOpen?: boolean;
  teacherMarkingClosesOn?: string;
}

const MAX_SERIES_SESSIONS = 60;

// Calendar dates (YYYY-MM-DD) every `everyWeeks` weeks, in UTC so no timezone shifts a day.
export function seriesDates(
  start: string,
  end: string,
  everyWeeks: number,
): string[] {
  const out: string[] = [];
  const d = new Date(`${start.slice(0, 10)}T00:00:00Z`);
  const last = new Date(`${end.slice(0, 10)}T00:00:00Z`);
  while (d <= last && out.length <= MAX_SERIES_SESSIONS) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7 * everyWeeks);
  }
  return out;
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
    private readonly settings: SundaySchoolSettingsService,
  ) {}

  // With "one class per member" on: memberId → name of another class they're already in.
  private async otherClassOf(
    memberIds: string[],
    classId: string,
  ): Promise<Map<string, string>> {
    if (!memberIds.length || !(await this.settings.isOneClassPerMember())) {
      return new Map();
    }
    const rows = await this.memberAssignRepo.find({
      where: { member: { id: In(memberIds) } },
      relations: ['member', 'sundaySchoolClass'],
    });
    const other = new Map<string, string>();
    for (const row of rows) {
      if (row.sundaySchoolClass.id !== classId && !other.has(row.member.id)) {
        other.set(row.member.id, row.sundaySchoolClass.name);
      }
    }
    return other;
  }

  private async assertNotInAnotherClass(memberId: string, classId: string) {
    const className = (await this.otherClassOf([memberId], classId)).get(
      memberId,
    );
    if (className) {
      throw new BadRequestException(
        `This member is already in ${className}. Your church allows one Sunday School class per member — remove them from ${className} first.`,
      );
    }
  }

  async createClass(
    user: MemberAuth,
    dto: CreateSundaySchoolClassDto,
  ): Promise<SundaySchoolClass & { membersCount: number }> {
    await this.requireSundaySchoolAuth(user);
    this.logger.log(`Creating Sunday School class: ${dto.name}`);
    return this.adminCreateClass(dto);
  }

  async updateClass(
    user: MemberAuth,
    id: string,
    dto: UpdateSundaySchoolClassDto,
  ): Promise<SundaySchoolClass & { membersCount: number }> {
    await this.requireSundaySchoolAuth(user, id);
    this.logger.log(`Updating Sunday School class ${id}`);
    return this.adminUpdateClass(id, dto);
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
      relations: ['teacher', 'assistants'],
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
      relations: ['teacher', 'assistants'],
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
    await this.settings.assertTeachersCanAddMembers();
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
    await this.assertNotInAnotherClass(dto.memberId, classId);
    const assignment = this.memberAssignRepo.create({
      member: { id: dto.memberId } as Member,
      sundaySchoolClass: cls,
    });
    return this.memberAssignRepo.save(assignment);
  }

  async bulkAssignMembers(
    user: MemberAuth,
    classId: string,
    memberIds?: string[],
    emails?: string[],
  ) {
    await this.requireSundaySchoolAuth(user, classId);
    await this.settings.assertTeachersCanAddMembers();
    return this.adminBulkAssignMembers(classId, memberIds, emails);
  }

  async classCandidates(
    user: MemberAuth,
    classId: string,
    search?: string,
    page = 1,
    limit = 50,
  ) {
    await this.requireSundaySchoolAuth(user, classId);
    await this.settings.assertTeachersCanAddMembers();
    return this.adminClassCandidates(classId, search, page, limit);
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
    await this.assertTeacherCanStillMark(session);
    this.logger.log(
      `Opening self-mark for session ${sessionId} for ${closesInMinutes} minutes`,
    );
    const closesAt = new Date();
    closesAt.setMinutes(closesAt.getMinutes() + closesInMinutes);
    session.selfMarkClosesAt = closesAt;
    const saved = await this.sessionRepo.save(session);
    await this.notifyCheckInOpen(session);
    return this.withSelfMarkOpen(saved);
  }

  // Push to class members who haven't been marked yet; one per opening (idempotency keyed on the close time).
  // Never blocks opening check-in: a failed lookup or push is only logged.
  private async notifyCheckInOpen(session: SundaySchoolSession): Promise<void> {
    const cls = session.sundaySchoolClass;
    const closesAt = session.selfMarkClosesAt;
    if (!cls || !closesAt) return;
    try {
      const [members, marked] = await Promise.all([
        this.memberAssignRepo.find({
          where: { sundaySchoolClass: { id: cls.id } },
          relations: ['member'],
          select: { id: true, member: { id: true } },
        }),
        this.attendanceRepo.find({
          where: { session: { id: session.id } },
          relations: ['member'],
          select: { id: true, member: { id: true } },
        }),
      ]);
      const done = new Set(marked.map((a) => a.member?.id));
      const memberIds = members
        .map((m) => m.member.id)
        .filter((id) => !done.has(id));
      if (!memberIds.length) return;
      await this.notificationDispatchService.notifyMember({
        category: EmailCategory.SUNDAY_SCHOOL_ATTENDANCE,
        push: {
          memberIds,
          key: PushNotificationKey.SUNDAY_SCHOOL_CHECKIN_OPEN,
          vars: {
            class_name: cls.name,
            closes_at: closesAt.toLocaleTimeString('en-GB', {
              timeZone: CHURCH_TIMEZONE,
              hour: '2-digit',
              minute: '2-digit',
            }),
          },
          idempotencyKey: `sunday-school-checkin-open:${session.id}:${closesAt.getTime()}`,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Check-in push failed for session ${session.id}: ${(err as Error).message}`,
      );
    }
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
    await this.assertTeacherCanStillMark(session);
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
    await this.settings.assertTeachersCanCheckInFirstTimers();
    await this.assertTeacherCanStillMark(session);
    return this.recordFirstTimerCheckIn(sessionId, dto, {
      memberCreatorId: user.id,
    });
  }

  async adminCheckInFirstTimer(
    sessionId: string,
    dto: CheckInFirstTimerDto,
    adminId: string,
  ): Promise<SundaySchoolAttendance> {
    const exists = await this.sessionRepo.existsBy({ id: sessionId });
    if (!exists) throw new NotFoundException('Session not found');
    return this.recordFirstTimerCheckIn(sessionId, dto, {
      adminCreatorId: adminId,
    });
  }

  private async recordFirstTimerCheckIn(
    sessionId: string,
    dto: CheckInFirstTimerDto,
    actor: { memberCreatorId?: string; adminCreatorId?: string },
  ): Promise<SundaySchoolAttendance> {
    const firstTimer =
      await this.followUpService.createFirstTimerFromSundaySchoolCheckIn(
        {
          firstname: dto.firstname,
          lastname: dto.lastname,
          phone: dto.phone,
          notes: dto.notes,
        },
        actor,
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

    const marking = await this.teacherMarkingWindow(session.sessionDate);
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
      teacherMarkingOpen: marking.open,
      teacherMarkingClosesOn: marking.closesOn,
    };
  }

  // ─── Questions (Q&A) ──────────────────────────────────────────────────────

  async getMyClasses(user: MemberAuth): Promise<SundaySchoolClass[]> {
    const assignments = await this.memberAssignRepo.find({
      where: { member: { id: user.id } },
      relations: ['sundaySchoolClass', 'sundaySchoolClass.teacher'],
    });
    // Members only need the teacher's name, not their profile.
    return assignments.map(({ sundaySchoolClass: c }) => ({
      ...c,
      teacher: c.teacher
        ? ({
            id: c.teacher.id,
            firstname: c.teacher.firstname,
            lastname: c.teacher.lastname,
          } as Member)
        : null,
    }));
  }

  // Classes this worker teaches or assists — the Teach tab for teachers outside the Sunday School department.
  async getMyTeachingClasses(
    user: MemberAuth,
  ): Promise<(SundaySchoolClass & { membersCount: number })[]> {
    const classes = await this.classRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.teacher', 'teacher')
      .leftJoinAndSelect('c.assistants', 'assistant')
      .where(
        `teacher.id = :me OR EXISTS (SELECT 1 FROM sunday_school_class_assistants a WHERE a.sunday_school_class_id = c.id AND a.member_id = :me)`,
        { me: user.id },
      )
      .orderBy('c.name', 'ASC')
      .getMany();
    return this.attachMembersCount(classes);
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
          key: PushNotificationKey.SUNDAY_SCHOOL_QUESTION_ASKED,
          vars: { asker_name: askerName, class_name: cls.name },
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
        key: PushNotificationKey.SUNDAY_SCHOOL_QUESTION_UNASSIGNED,
        vars: { asker_name: askerName, class_name: cls.name },
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
        key: PushNotificationKey.SUNDAY_SCHOOL_QUESTION_ANSWERED,
        vars: { class_name: question.sundaySchoolClass.name },
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
    await this.applyClassDetails(entity, dto);
    const saved = await this.classRepo.save(entity);
    return { ...saved, membersCount: 0 };
  }

  // Shared by create/update: age group, meeting day/time, room, assistants (undefined = leave as is).
  private async applyClassDetails(
    entity: SundaySchoolClass,
    dto: UpdateSundaySchoolClassDto,
  ): Promise<void> {
    if (dto.ageGroup !== undefined) entity.ageGroup = dto.ageGroup || null;
    if (dto.meetingDay !== undefined) entity.meetingDay = dto.meetingDay;
    if (dto.meetingTime !== undefined)
      entity.meetingTime = dto.meetingTime || null;
    if (dto.location !== undefined) entity.location = dto.location || null;
    if (dto.assistantIds !== undefined) {
      const teacherId = dto.teacherId ?? entity.teacher?.id;
      const ids = [...new Set(dto.assistantIds)].filter(
        (id) => id !== teacherId,
      );
      const found = ids.length
        ? await this.memberRepo.find({
            where: { id: In(ids) },
            select: { id: true, firstname: true, lastname: true },
          })
        : [];
      if (found.length !== ids.length)
        throw new NotFoundException('Assistant teacher not found');
      entity.assistants = found;
    }
  }

  async adminUpdateClass(
    id: string,
    dto: UpdateSundaySchoolClassDto,
  ): Promise<SundaySchoolClass & { membersCount: number }> {
    if (dto.teacherId) await this.assertMemberExists(dto.teacherId);
    const entity = await this.classRepo.findOne({
      where: { id },
      relations: ['teacher'],
    });
    if (!entity) throw new NotFoundException('Sunday School class not found');
    if (dto.name !== undefined) entity.name = dto.name;
    if (dto.description !== undefined)
      entity.description = dto.description ?? null;
    if (dto.teacherId !== undefined) {
      entity.teacher = dto.teacherId ? ({ id: dto.teacherId } as Member) : null;
    }
    await this.applyClassDetails(entity, dto);
    await this.classRepo.save(entity);
    const saved = await this.classRepo.findOne({
      where: { id },
      relations: ['teacher', 'assistants'],
    });
    return (await this.attachMembersCount([saved!]))[0];
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
    await this.assertNotInAnotherClass(memberId, classId);
    const assignment = this.memberAssignRepo.create({
      member: { id: memberId } as Member,
      sundaySchoolClass: cls,
    });
    return this.memberAssignRepo.save(assignment);
  }

  // One request for many members: already-assigned ones are skipped, unknown emails reported back.
  async adminBulkAssignMembers(
    classId: string,
    memberIds: string[] = [],
    emails: string[] = [],
  ): Promise<{
    added: number;
    alreadyInClass: number;
    notFound: string[];
    inAnotherClass: { memberId: string; className: string }[];
  }> {
    if (!memberIds.length && !emails.length) {
      throw new BadRequestException('Choose at least one member to add.');
    }
    const cls = await this.classRepo.findOne({ where: { id: classId } });
    if (!cls) throw new NotFoundException('Sunday School class not found');

    const wantedEmails = [
      ...new Set(emails.map((e) => e.trim().toLowerCase())),
    ];
    const [byId, byEmail] = await Promise.all([
      memberIds.length
        ? this.memberRepo.find({
            where: { id: In([...new Set(memberIds)]) },
            select: { id: true },
          })
        : Promise.resolve([] as Member[]),
      wantedEmails.length
        ? this.memberRepo
            .createQueryBuilder('m')
            .select(['m.id', 'm.email'])
            .where('LOWER(m.email) IN (:...emails)', { emails: wantedEmails })
            .getMany()
        : Promise.resolve([] as Member[]),
    ]);

    const foundEmails = new Set(byEmail.map((m) => m.email.toLowerCase()));
    const foundIds = new Set(byId.map((m) => m.id));
    const notFound = [
      ...memberIds.filter((id) => !foundIds.has(id)),
      ...wantedEmails.filter((email) => !foundEmails.has(email)),
    ];
    const ids = [...new Set([...foundIds, ...byEmail.map((m) => m.id)])];
    if (!ids.length) {
      return { added: 0, alreadyInClass: 0, notFound, inAnotherClass: [] };
    }

    const existing = await this.memberAssignRepo.find({
      where: { sundaySchoolClass: { id: classId }, member: { id: In(ids) } },
      relations: ['member'],
    });
    const assigned = new Set(existing.map((a) => a.member.id));
    const otherClass = await this.otherClassOf(
      ids.filter((id) => !assigned.has(id)),
      classId,
    );
    const toAdd = ids.filter((id) => !assigned.has(id) && !otherClass.has(id));
    if (toAdd.length) {
      await this.memberAssignRepo.save(
        toAdd.map((id) =>
          this.memberAssignRepo.create({
            member: { id } as Member,
            sundaySchoolClass: cls,
          }),
        ),
      );
    }
    return {
      added: toAdd.length,
      alreadyInClass: assigned.size,
      notFound,
      inAnotherClass: [...otherClass].map(([memberId, className]) => ({
        memberId,
        className,
      })),
    };
  }

  // Members who can be added to a class: not already in it, active, optionally searched. Each row says which other
  // class (if any) they're in, and whether that blocks them under "one class per member".
  async adminClassCandidates(
    classId: string,
    search?: string,
    page = 1,
    limit = 50,
  ) {
    const cls = await this.classRepo.findOne({ where: { id: classId } });
    if (!cls) throw new NotFoundException('Sunday School class not found');
    const size = Math.min(Math.max(limit, 1), 100);
    const qb = this.memberRepo
      .createQueryBuilder('m')
      .select(['m.id', 'm.firstname', 'm.lastname', 'm.email'])
      .where(
        `NOT EXISTS (SELECT 1 FROM sunday_school_members x WHERE x.member_id = m.id AND x.sunday_school_class_id = :classId)`,
        { classId },
      )
      .andWhere('m.status != :inactive', {
        inactive: MemberStatusEnum.INACTIVE,
      })
      .orderBy('m.firstname', 'ASC')
      .addOrderBy('m.lastname', 'ASC')
      .skip((page - 1) * size)
      .take(size);
    // One ILIKE group per word so "ada obi" matches first + last name and every branch can use the trigram indexes.
    const words = (search ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3);
    words.forEach((word, i) => {
      qb.andWhere(
        `(m.firstname ILIKE :w${i} OR m.lastname ILIKE :w${i} OR m.email ILIKE :w${i})`,
        { [`w${i}`]: `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%` },
      );
    });
    const [members, totalCount] = await qb.getManyAndCount();
    const [oneClassPerMember, memberships] = await Promise.all([
      this.settings.isOneClassPerMember(),
      members.length
        ? this.memberAssignRepo.find({
            where: { member: { id: In(members.map((m) => m.id)) } },
            relations: ['member', 'sundaySchoolClass'],
          })
        : Promise.resolve([] as SundaySchoolMember[]),
    ]);
    const classesOf = new Map<string, string[]>();
    for (const row of memberships) {
      classesOf.set(row.member.id, [
        ...(classesOf.get(row.member.id) ?? []),
        row.sundaySchoolClass.name,
      ]);
    }
    return {
      data: members.map((m) => {
        const otherClasses = classesOf.get(m.id) ?? [];
        return {
          id: m.id,
          firstname: m.firstname,
          lastname: m.lastname,
          email: m.email,
          otherClasses,
          blocked: oneClassPerMember && otherClasses.length > 0,
        };
      }),
      page,
      limit: size,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / size)),
      oneClassPerMember,
    };
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

  async updateSession(
    user: MemberAuth,
    sessionId: string,
    dto: UpdateSundaySchoolSessionDto,
  ): Promise<SundaySchoolSession & { selfMarkOpen: boolean }> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
      relations: ['sundaySchoolClass'],
    });
    if (!session) throw new NotFoundException('Session not found');
    await this.requireSundaySchoolAuth(user, session.sundaySchoolClass.id);
    return this.adminUpdateSession(sessionId, dto);
  }

  // Attendance stays attached; moving onto a date the class already has a session on is refused.
  async adminUpdateSession(
    sessionId: string,
    dto: UpdateSundaySchoolSessionDto,
  ): Promise<SundaySchoolSession & { selfMarkOpen: boolean }> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
      relations: ['sundaySchoolClass'],
    });
    if (!session) throw new NotFoundException('Session not found');
    if (
      dto.sessionDate !== undefined &&
      dto.sessionDate !== session.sessionDate
    ) {
      const clash = await this.sessionRepo.findOne({
        where: {
          sundaySchoolClass: { id: session.sundaySchoolClass.id },
          sessionDate: dto.sessionDate,
        },
      });
      if (clash)
        throw new ConflictException(
          'A session already exists for this class on the selected date.',
        );
      session.sessionDate = dto.sessionDate;
    }
    if (dto.notes !== undefined) session.notes = dto.notes || null;
    if (dto.documentUrl !== undefined)
      session.documentUrl = dto.documentUrl || null;
    const saved = await this.saveNewSession(session);
    return this.withSelfMarkOpen(saved);
  }

  async createSessionSeries(
    user: MemberAuth,
    dto: CreateSundaySchoolSessionSeriesDto,
  ) {
    await this.requireSundaySchoolAuth(user, dto.classId);
    return this.adminCreateSessionSeries(dto);
  }

  // One session every N weeks from startDate to endDate (inclusive); dates that already have one are skipped.
  async adminCreateSessionSeries(
    dto: CreateSundaySchoolSessionSeriesDto,
  ): Promise<{ created: number; skipped: string[]; dates: string[] }> {
    const cls = await this.classRepo.findOne({ where: { id: dto.classId } });
    if (!cls) throw new NotFoundException('Sunday School class not found');
    const dates = seriesDates(dto.startDate, dto.endDate, dto.everyWeeks ?? 1);
    if (!dates.length)
      throw new BadRequestException(
        'The end date must be on or after the start date.',
      );
    if (dates.length > MAX_SERIES_SESSIONS)
      throw new BadRequestException(
        `That's ${dates.length} sessions — create at most ${MAX_SERIES_SESSIONS} at a time.`,
      );
    const existing = await this.sessionRepo.find({
      where: { sundaySchoolClass: { id: dto.classId }, sessionDate: In(dates) },
      select: { id: true, sessionDate: true },
    });
    const taken = new Set(existing.map((s) => s.sessionDate));
    const toCreate = dates.filter((d) => !taken.has(d));
    if (toCreate.length) {
      await this.sessionRepo
        .createQueryBuilder()
        .insert()
        .values(
          toCreate.map((sessionDate) => ({
            sundaySchoolClass: { id: dto.classId },
            sessionDate,
            notes: dto.notes ?? null,
          })),
        )
        .orIgnore()
        .execute();
    }
    this.logger.log(
      `Created ${toCreate.length} sessions for class ${dto.classId} (${dates[0]} → ${dates[dates.length - 1]})`,
    );
    return {
      created: toCreate.length,
      skipped: dates.filter((d) => taken.has(d)),
      dates: toCreate,
    };
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
      relations: ['sundaySchoolClass'],
    });
    if (!session) throw new NotFoundException('Session not found');
    const closesAt = new Date();
    closesAt.setMinutes(closesAt.getMinutes() + closesInMinutes);
    session.selfMarkClosesAt = closesAt;
    const saved = await this.sessionRepo.save(session);
    await this.notifyCheckInOpen(session);
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
  // Teachers can mark a session until N days after its date (church time); admin routes skip this.
  private async teacherMarkingWindow(
    sessionDate: string,
  ): Promise<{ open: boolean; closesOn: string }> {
    const days = await this.settings.teacherMarkingDays();
    const closesOn = addDays(sessionDate, days);
    return { open: todayInChurchTz() <= closesOn, closesOn };
  }

  private async assertTeacherCanStillMark(
    session: SundaySchoolSession,
  ): Promise<void> {
    const { open, closesOn } = await this.teacherMarkingWindow(
      session.sessionDate,
    );
    if (!open)
      throw new ForbiddenException(
        `Attendance for this session closed on ${closesOn}. Ask an admin to make any changes.`,
      );
  }

  assertCanManageClass(user: MemberAuth, classId: string): Promise<void> {
    return this.requireSundaySchoolAuth(user, classId);
  }

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
      where: [
        { id: classId, teacher: { id: memberId } },
        { id: classId, assistants: { id: memberId } },
      ],
    });
    return !!cls;
  }
}
