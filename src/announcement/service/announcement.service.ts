import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { Announcement } from '../entity/announcement.entity';
import { AnnouncementReaction } from '../entity/announcement-reaction.entity';
import {
  CreateAnnouncementDto,
  UpdateAnnouncementDto,
} from '../dto/create-announcement.dto';
import { SendSmsBroadcastDto } from '../dto/send-sms-broadcast.dto';
import { ReactToAnnouncementDto } from '../dto/react-to-announcement.dto';
import { AnnouncementAudienceEnum } from '../enum/announcement-audience.enum';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { Department } from '../../department/entity/department.entity';
import { Member } from '../../member/entity/member.entity';
import { Group } from '../../group/entity/group.entity';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';
import { SanitizationService } from '../../utility/service/sanitization.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { GroupService } from '../../group/service/group.service';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';
import { SmsService } from '../../sms/service/sms.service';
import { Admin } from '../../admin/entity/admin.entity';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';

function toNullableRef<T extends { id: string }>(id?: string): T | null {
  return id ? ({ id } as T) : null;
}

@Injectable()
export class AnnouncementService {
  constructor(
    @InjectRepository(Announcement)
    private readonly announcementRepo: Repository<Announcement>,
    @InjectRepository(AnnouncementReaction)
    private readonly reactionRepo: Repository<AnnouncementReaction>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    private readonly sanitizationService: SanitizationService,
    private readonly auditLogService: AuditLogService,
    private readonly groupService: GroupService,
    private readonly pushNotificationService: PushNotificationService,
    private readonly smsService: SmsService,
  ) {}

  private readonly logger = new Logger(AnnouncementService.name);

  async create(
    dto: CreateAnnouncementDto,
    authorId: string,
    admin: Admin,
  ): Promise<Announcement> {
    if (
      dto.audience === AnnouncementAudienceEnum.DEPARTMENT &&
      !dto.departmentId
    ) {
      throw new BadRequestException(
        'departmentId is required for DEPARTMENT audience',
      );
    }
    if (
      dto.audience === AnnouncementAudienceEnum.INDIVIDUAL &&
      !dto.targetMemberId
    ) {
      throw new BadRequestException(
        'targetMemberId is required for INDIVIDUAL audience',
      );
    }
    if (dto.audience === AnnouncementAudienceEnum.GROUP && !dto.groupId) {
      throw new BadRequestException('groupId is required for GROUP audience');
    }
    this.assertCanSendViaSms(dto.sendViaSms, admin);

    const announcement = this.announcementRepo.create({
      title: dto.title,
      body: this.sanitizationService.sanitizeForEmail(dto.body),
      audience: dto.audience ?? AnnouncementAudienceEnum.ALL,
      author: { id: authorId } as Member,
      department: dto.departmentId ? { id: dto.departmentId } : null,
      targetMember: dto.targetMemberId ? { id: dto.targetMemberId } : null,
      group: dto.groupId ? { id: dto.groupId } : null,
      publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : new Date(),
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      sendViaSms: dto.sendViaSms ?? false,
      smsBody: dto.sendViaSms ? dto.smsBody : null,
    });

    const saved = await this.announcementRepo.save(announcement);
    this.logger.log(
      `Announcement "${saved.title}" published to ${saved.audience} audience (id: ${saved.id}) by actor ${authorId}`,
    );
    this.auditLogService.log('ANNOUNCEMENT_CREATED', {
      actorId: authorId,
      targetId: saved.id,
      metadata: { title: saved.title, audience: saved.audience },
    });

    if (saved.audience === AnnouncementAudienceEnum.GROUP && dto.groupId) {
      this.notifyGroup(dto.groupId, saved);
    }

    if (saved.sendViaSms) {
      // Awaited deliberately, unlike the fire-and-forget push notification
      // above — this is a paid external API call, so a failure must be
      // caught and logged synchronously rather than silently dropped.
      // dispatchSms swallows its own errors, so this never fails create().
      await this.dispatchSms(saved);
    }

    return saved;
  }

  private notifyGroup(groupId: string, announcement: Announcement): void {
    this.groupService
      .getMemberIdsForGroup(groupId)
      .then((memberIds) =>
        this.pushNotificationService.dispatchToMemberIds(memberIds, {
          idempotencyKey: announcement.id,
          title: announcement.title,
          body: announcement.body.slice(0, 150),
          url: '/announcements',
        }),
      )
      .catch((err: Error) =>
        this.logger.warn(
          `Failed to dispatch group push notification for announcement ${announcement.id}: ${err.message}`,
        ),
      );
  }

  async update(
    id: string,
    dto: UpdateAnnouncementDto,
    actorId: string,
    admin: Admin,
  ): Promise<Announcement> {
    const announcement = await this.getOrThrow(id);
    this.assertCanSendViaSms(dto.sendViaSms, admin);

    const sendingSmsNow = dto.sendViaSms === true && !announcement.sendViaSms;

    if (dto.title !== undefined) announcement.title = dto.title;
    if (dto.body !== undefined)
      announcement.body = this.sanitizationService.sanitizeForEmail(dto.body);
    if (dto.audience !== undefined) announcement.audience = dto.audience;
    if (dto.departmentId !== undefined)
      announcement.department = toNullableRef<Department>(dto.departmentId);
    if (dto.targetMemberId !== undefined)
      announcement.targetMember = toNullableRef<Member>(dto.targetMemberId);
    if (dto.groupId !== undefined)
      announcement.group = toNullableRef<Group>(dto.groupId);
    if (dto.publishedAt !== undefined)
      announcement.publishedAt = new Date(dto.publishedAt);
    if (dto.expiresAt !== undefined)
      announcement.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (dto.sendViaSms !== undefined) announcement.sendViaSms = dto.sendViaSms;
    if (dto.smsBody !== undefined) announcement.smsBody = dto.smsBody;

    const saved = await this.announcementRepo.save(announcement);
    this.auditLogService.log('ANNOUNCEMENT_UPDATED', {
      actorId,
      targetId: id,
      metadata: {
        title: saved.title,
        audience: saved.audience,
        changes: Object.keys(dto),
      },
    });

    // Only dispatch on the transition into sendViaSms=true — re-saving an
    // already-SMS'd announcement (e.g. editing its title afterward) must not
    // re-text everyone.
    if (sendingSmsNow) {
      await this.dispatchSms(saved);
    }

    return saved;
  }

  private assertCanSendViaSms(
    sendViaSms: boolean | undefined,
    admin: Admin,
  ): void {
    if (!sendViaSms) return;
    if (!admin.adminRole.permissions.includes(AdminPermission.SMS_SEND)) {
      throw new ForbiddenException(
        `Missing required permission: ${AdminPermission.SMS_SEND}`,
      );
    }
  }

  async sendSmsBroadcast(
    dto: SendSmsBroadcastDto,
    actorId: string,
  ): Promise<{ sentCount: number }> {
    if (
      dto.audience === AnnouncementAudienceEnum.DEPARTMENT &&
      !dto.departmentId
    ) {
      throw new BadRequestException(
        'departmentId is required for DEPARTMENT audience',
      );
    }
    if (
      dto.audience === AnnouncementAudienceEnum.INDIVIDUAL &&
      !dto.targetMemberId
    ) {
      throw new BadRequestException(
        'targetMemberId is required for INDIVIDUAL audience',
      );
    }
    if (dto.audience === AnnouncementAudienceEnum.GROUP && !dto.groupId) {
      throw new BadRequestException('groupId is required for GROUP audience');
    }

    const phoneNumbers = await this.resolvePhoneNumbers({
      audience: dto.audience,
      departmentId: dto.departmentId,
      targetMemberId: dto.targetMemberId,
      groupId: dto.groupId,
    });

    if (phoneNumbers.length === 0) {
      return { sentCount: 0 };
    }

    await this.smsService.send(phoneNumbers, dto.message);

    this.logger.log(
      `SMS-only broadcast sent to ${phoneNumbers.length} recipient(s) for ${dto.audience} audience by actor ${actorId}`,
    );
    this.auditLogService.log('SMS_BROADCAST_SENT', {
      actorId,
      metadata: { audience: dto.audience, count: phoneNumbers.length },
    });

    return { sentCount: phoneNumbers.length };
  }

  private async dispatchSms(announcement: Announcement): Promise<void> {
    try {
      if (!announcement.smsBody) return;
      const phoneNumbers = await this.resolvePhoneNumbers({
        audience: announcement.audience,
        departmentId: announcement.department?.id,
        targetMemberId: announcement.targetMember?.id,
        groupId: announcement.group?.id,
      });
      if (phoneNumbers.length === 0) return;
      await this.smsService.send(phoneNumbers, announcement.smsBody);
    } catch (err: any) {
      this.logger.error(
        `Failed to dispatch SMS for announcement ${announcement.id}: ${err?.message ?? err}`,
      );
    }
  }

  private async resolvePhoneNumbers(target: {
    audience: AnnouncementAudienceEnum;
    departmentId?: string;
    targetMemberId?: string;
    groupId?: string;
  }): Promise<string[]> {
    if (target.audience === AnnouncementAudienceEnum.GROUP) {
      if (!target.groupId) return [];
      return this.resolveGroupPhoneNumbers(target.groupId);
    }

    const qb = this.memberRepo
      .createQueryBuilder('m')
      .leftJoin('m.workerProfile', 'wp')
      .where('m.phoneNumber IS NOT NULL')
      .andWhere('m.status = :status', { status: MemberStatusEnum.ACTIVE });

    switch (target.audience) {
      case AnnouncementAudienceEnum.MEMBERS_ONLY:
        qb.andWhere('m.role = :role', { role: MemberRoleEnum.MEMBER });
        break;
      case AnnouncementAudienceEnum.WORKERS_ONLY:
        qb.andWhere('m.role = :role', { role: MemberRoleEnum.WORKER });
        break;
      case AnnouncementAudienceEnum.DEPARTMENT:
        if (!target.departmentId) return [];
        qb.andWhere('wp.department = :deptId', {
          deptId: target.departmentId,
        });
        break;
      case AnnouncementAudienceEnum.INDIVIDUAL:
        if (!target.targetMemberId) return [];
        qb.andWhere('m.id = :memberId', {
          memberId: target.targetMemberId,
        });
        break;
      case AnnouncementAudienceEnum.ALL:
      default:
        break;
    }

    const members = await qb.getMany();
    return members.map((m) => m.phoneNumber).filter((p): p is string => !!p);
  }

  // A group can hold real Members (need the active/phone-on-file filter,
  // like every other audience) and phone-only entries (already just raw
  // numbers, e.g. imported first-timers with no Member account) — these
  // two sources are unioned+deduped rather than resolved via one querybuilder.
  private async resolveGroupPhoneNumbers(groupId: string): Promise<string[]> {
    const memberIds = await this.groupService.getMemberIdsForGroup(groupId);
    let memberPhones: string[] = [];
    if (memberIds.length > 0) {
      const members = await this.memberRepo.find({
        where: {
          id: In(memberIds),
          status: MemberStatusEnum.ACTIVE,
          phoneNumber: Not(IsNull()),
        },
      });
      memberPhones = members
        .map((m) => m.phoneNumber)
        .filter((p): p is string => !!p);
    }

    const phoneOnlyNumbers =
      await this.groupService.getPhoneOnlyNumbersForGroup(groupId);

    return [...new Set([...memberPhones, ...phoneOnlyNumbers])];
  }

  async delete(id: string, actorId: string): Promise<void> {
    const announcement = await this.getOrThrow(id);
    // Capture title before removal — record is gone after this line
    const { title, audience } = announcement;
    await this.announcementRepo.remove(announcement);
    this.auditLogService.log('ANNOUNCEMENT_DELETED', {
      actorId,
      targetId: id,
      metadata: { title, audience },
    });
  }

  async getById(id: string): Promise<Announcement> {
    return this.getOrThrow(id);
  }

  async getForMember(
    memberId: string,
    role: MemberRoleEnum,
    departmentId: string | null,
    page = 1,
    limit = 10,
  ): Promise<PaginationResponseDto<Announcement>> {
    const now = new Date();

    const inMemberGroup =
      '(a.audience = :group AND EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = grp.id AND gm.member_id = :memberId))';

    const qb = this.announcementRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.author', 'author')
      .leftJoinAndSelect('a.department', 'department')
      .leftJoinAndSelect('a.targetMember', 'targetMember')
      .leftJoinAndSelect('a.group', 'grp')
      .where('(a.publishedAt IS NULL OR a.publishedAt <= :now)', { now })
      .andWhere('(a.expiresAt IS NULL OR a.expiresAt > :now)', { now })
      .orderBy('a.publishedAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (role === MemberRoleEnum.MEMBER) {
      qb.andWhere(
        `(a.audience = :all OR a.audience = :membersOnly OR (a.audience = :individual AND targetMember.id = :memberId) OR ${inMemberGroup})`,
        {
          all: AnnouncementAudienceEnum.ALL,
          membersOnly: AnnouncementAudienceEnum.MEMBERS_ONLY,
          individual: AnnouncementAudienceEnum.INDIVIDUAL,
          group: AnnouncementAudienceEnum.GROUP,
          memberId,
        },
      );
    } else if (role === MemberRoleEnum.WORKER && departmentId) {
      qb.andWhere(
        `(a.audience = :all OR a.audience = :workers OR (a.audience = :dept AND department.id = :departmentId) OR (a.audience = :individual AND targetMember.id = :memberId) OR ${inMemberGroup})`,
        {
          all: AnnouncementAudienceEnum.ALL,
          workers: AnnouncementAudienceEnum.WORKERS_ONLY,
          dept: AnnouncementAudienceEnum.DEPARTMENT,
          individual: AnnouncementAudienceEnum.INDIVIDUAL,
          group: AnnouncementAudienceEnum.GROUP,
          departmentId,
          memberId,
        },
      );
    } else {
      qb.andWhere(
        `(a.audience = :all OR a.audience = :workers OR (a.audience = :individual AND targetMember.id = :memberId) OR ${inMemberGroup})`,
        {
          all: AnnouncementAudienceEnum.ALL,
          workers: AnnouncementAudienceEnum.WORKERS_ONLY,
          individual: AnnouncementAudienceEnum.INDIVIDUAL,
          group: AnnouncementAudienceEnum.GROUP,
          memberId,
        },
      );
    }

    const [announcements, total] = await qb.getManyAndCount();
    return UtilityService.createPaginationResponse(
      announcements,
      page,
      limit,
      total,
    );
  }

  async getAll(
    page = 1,
    limit = 10,
    search?: string,
    audience?: AnnouncementAudienceEnum,
  ): Promise<PaginationResponseDto<Announcement>> {
    const qb = this.announcementRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.author', 'author')
      .leftJoinAndSelect('a.department', 'department')
      .leftJoinAndSelect('a.targetMember', 'targetMember')
      .leftJoinAndSelect('a.group', 'grp')
      .orderBy('a.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (audience) qb.andWhere('a.audience = :audience', { audience });

    if (search) {
      qb.andWhere('LOWER(a.title) LIKE :s', {
        s: `%${search.toLowerCase()}%`,
      });
    }

    const [announcements, total] = await qb.getManyAndCount();
    return UtilityService.createPaginationResponse(
      announcements,
      page,
      limit,
      total,
    );
  }

  async react(
    announcementId: string,
    memberId: string,
    dto: ReactToAnnouncementDto,
  ): Promise<AnnouncementReaction> {
    await this.getOrThrow(announcementId);

    const existing = await this.reactionRepo.findOne({
      where: {
        announcement: { id: announcementId },
        member: { id: memberId },
      },
    });

    if (existing) {
      existing.emoji = dto.emoji;
      return this.reactionRepo.save(existing);
    }

    const reaction = this.reactionRepo.create({
      announcement: { id: announcementId } as Announcement,
      member: { id: memberId } as Member,
      emoji: dto.emoji,
    });
    return this.reactionRepo.save(reaction);
  }

  async removeReaction(
    announcementId: string,
    memberId: string,
  ): Promise<void> {
    await this.reactionRepo.delete({
      announcement: { id: announcementId },
      member: { id: memberId },
    });
  }

  async getReactionSummary(
    announcementId: string,
    memberId?: string,
  ): Promise<{
    summary: { emoji: string; count: number }[];
    myReaction: string | null;
  }> {
    const rows = await this.reactionRepo
      .createQueryBuilder('r')
      .select('r.emoji', 'emoji')
      .addSelect('COUNT(*)', 'count')
      .where('r.announcement_id = :announcementId', { announcementId })
      .groupBy('r.emoji')
      .getRawMany<{ emoji: string; count: string }>();

    const summary = rows.map((r) => ({
      emoji: r.emoji,
      count: Number.parseInt(r.count, 10),
    }));

    let myReaction: string | null = null;
    if (memberId) {
      const mine = await this.reactionRepo.findOne({
        where: {
          announcement: { id: announcementId },
          member: { id: memberId },
        },
      });
      myReaction = mine?.emoji ?? null;
    }

    return { summary, myReaction };
  }

  private async getOrThrow(id: string): Promise<Announcement> {
    const announcement = await this.announcementRepo.findOne({
      where: { id },
      relations: ['author', 'department', 'targetMember', 'group'],
    });
    if (!announcement) throw new NotFoundException('Announcement not found');
    return announcement;
  }
}
