import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SmallGroup } from '../entity/small-group.entity';
import { SmallGroupMember } from '../entity/small-group-member.entity';
import { SmallGroupAttendance } from '../entity/small-group-attendance.entity';
import {
  CreateSmallGroupDto,
  UpdateSmallGroupDto,
} from '../dto/small-group.dto';
import { RecordAttendanceDto } from '../dto/record-attendance.dto';
import { Member } from '../../member/entity/member.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';

@Injectable()
export class SmallGroupService {
  constructor(
    @InjectRepository(SmallGroup)
    private readonly groupRepo: Repository<SmallGroup>,
    @InjectRepository(SmallGroupMember)
    private readonly memberRepo: Repository<SmallGroupMember>,
    @InjectRepository(SmallGroupAttendance)
    private readonly attendanceRepo: Repository<SmallGroupAttendance>,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ── Admin CRUD ─────────────────────────────────────────────────────────────

  async create(dto: CreateSmallGroupDto, admin: Admin): Promise<SmallGroup> {
    const group = this.groupRepo.create({
      name: dto.name,
      description: dto.description ?? null,
      leader: dto.leaderId ? ({ id: dto.leaderId } as Member) : null,
      meetingDay: dto.meetingDay ?? null,
      meetingLocation: dto.meetingLocation ?? null,
      createdBy: { id: admin.id } as Admin,
    });

    const saved = await this.groupRepo.save(group);
    this.auditLogService.log('SMALL_GROUP_CREATED', {
      actorId: admin.id,
      targetId: saved.id,
      metadata: { name: saved.name },
    });
    return saved;
  }

  async update(
    id: string,
    dto: UpdateSmallGroupDto,
    admin: Admin,
  ): Promise<SmallGroup> {
    const group = await this.getOrThrow(id);

    if (dto.name !== undefined) group.name = dto.name;
    if (dto.description !== undefined) group.description = dto.description;
    if (dto.leaderId !== undefined) {
      group.leader = dto.leaderId ? ({ id: dto.leaderId } as Member) : null;
    }
    if (dto.meetingDay !== undefined) group.meetingDay = dto.meetingDay;
    if (dto.meetingLocation !== undefined)
      group.meetingLocation = dto.meetingLocation;

    const saved = await this.groupRepo.save(group);
    this.auditLogService.log('SMALL_GROUP_UPDATED', {
      actorId: admin.id,
      targetId: id,
      metadata: { changes: Object.keys(dto) },
    });
    return saved;
  }

  async delete(id: string, admin: Admin): Promise<void> {
    const group = await this.getOrThrow(id);
    await this.groupRepo.remove(group);
    this.auditLogService.log('SMALL_GROUP_DELETED', {
      actorId: admin.id,
      targetId: id,
      metadata: { name: group.name },
    });
  }

  async list(page = 1, limit = 20): Promise<PaginationResponseDto<SmallGroup>> {
    if (page < 1) throw new BadRequestException('Page must be greater than 0');

    const [data, total] = await this.groupRepo
      .createQueryBuilder('g')
      .leftJoinAndSelect('g.leader', 'leader')
      .orderBy('g.name', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async getOne(id: string): Promise<SmallGroup> {
    const group = await this.groupRepo.findOne({
      where: { id },
      relations: ['leader'],
    });
    if (!group) throw new NotFoundException('Small group not found');
    return group;
  }

  async getRoster(groupId: string): Promise<SmallGroupMember[]> {
    await this.getOrThrow(groupId);
    return this.memberRepo.find({
      where: { group: { id: groupId } },
      relations: ['member'],
      order: { createdAt: 'ASC' },
    });
  }

  async removeMember(
    groupId: string,
    memberId: string,
    admin: Admin,
  ): Promise<void> {
    const membership = await this.memberRepo.findOne({
      where: { group: { id: groupId }, member: { id: memberId } },
    });
    if (!membership) throw new NotFoundException('Membership not found');

    await this.memberRepo.remove(membership);
    this.auditLogService.log('SMALL_GROUP_MEMBER_REMOVED', {
      actorId: admin.id,
      targetId: groupId,
      metadata: { memberId },
    });
  }

  async getAttendanceHistory(groupId: string): Promise<SmallGroupAttendance[]> {
    await this.getOrThrow(groupId);
    return this.attendanceRepo.find({
      where: { group: { id: groupId } },
      relations: ['member'],
      order: { meetingDate: 'DESC' },
    });
  }

  // ── Member-facing ────────────────────────────────────────────────────────

  async listGroupsWithMemberCount(page = 1, limit = 20) {
    if (page < 1) throw new BadRequestException('Page must be greater than 0');

    const [groups, total] = await this.groupRepo
      .createQueryBuilder('g')
      .leftJoinAndSelect('g.leader', 'leader')
      .orderBy('g.name', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const counts = groups.length
      ? await this.memberRepo
          .createQueryBuilder('m')
          .select('m.group', 'groupId')
          .addSelect('COUNT(*)', 'count')
          .where('m.group IN (:...ids)', { ids: groups.map((g) => g.id) })
          .groupBy('m.group')
          .getRawMany()
      : [];
    const countByGroup = new Map(
      counts.map((c) => [c.groupId, Number(c.count)]),
    );

    const data = groups.map((g) => ({
      ...g,
      memberCount: countByGroup.get(g.id) ?? 0,
    }));

    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async listMine(memberId: string): Promise<SmallGroup[]> {
    const memberships = await this.memberRepo.find({
      where: { member: { id: memberId } },
      relations: ['group', 'group.leader'],
    });
    return memberships.map((m) => m.group);
  }

  async getMembers(
    groupId: string,
    requestingMemberId: string,
  ): Promise<SmallGroupMember[]> {
    await this.assertIsGroupMember(groupId, requestingMemberId);
    return this.memberRepo.find({
      where: { group: { id: groupId } },
      relations: ['member'],
      order: { createdAt: 'ASC' },
    });
  }

  async join(groupId: string, memberId: string): Promise<SmallGroupMember> {
    await this.getOrThrow(groupId);

    const existing = await this.memberRepo.findOne({
      where: { group: { id: groupId }, member: { id: memberId } },
    });
    if (existing) return existing;

    return this.memberRepo.save(
      this.memberRepo.create({
        group: { id: groupId } as SmallGroup,
        member: { id: memberId } as Member,
      }),
    );
  }

  async leave(groupId: string, memberId: string): Promise<void> {
    const membership = await this.memberRepo.findOne({
      where: { group: { id: groupId }, member: { id: memberId } },
    });
    if (!membership) {
      throw new NotFoundException('You are not a member of this group');
    }
    await this.memberRepo.remove(membership);
  }

  async recordAttendance(
    groupId: string,
    leaderMemberId: string,
    dto: RecordAttendanceDto,
  ): Promise<SmallGroupAttendance[]> {
    await this.assertIsGroupLeader(groupId, leaderMemberId);

    const saved: SmallGroupAttendance[] = [];
    for (const entry of dto.records) {
      const existing = await this.attendanceRepo.findOne({
        where: {
          group: { id: groupId },
          member: { id: entry.memberId },
          meetingDate: dto.meetingDate,
        },
      });

      if (existing) {
        existing.status = entry.status;
        saved.push(await this.attendanceRepo.save(existing));
      } else {
        saved.push(
          await this.attendanceRepo.save(
            this.attendanceRepo.create({
              group: { id: groupId } as SmallGroup,
              member: { id: entry.memberId } as Member,
              meetingDate: dto.meetingDate,
              status: entry.status,
            }),
          ),
        );
      }
    }
    return saved;
  }

  private async assertIsGroupMember(
    groupId: string,
    memberId: string,
  ): Promise<void> {
    const membership = await this.memberRepo.findOne({
      where: { group: { id: groupId }, member: { id: memberId } },
    });
    if (!membership) {
      throw new ForbiddenException('You must be a member of this group.');
    }
  }

  private async assertIsGroupLeader(
    groupId: string,
    memberId: string,
  ): Promise<void> {
    const group = await this.getOrThrow(groupId);
    if (!group.leader || group.leader.id !== memberId) {
      throw new ForbiddenException(
        "Only this group's leader can record attendance.",
      );
    }
  }

  private async getOrThrow(id: string): Promise<SmallGroup> {
    const group = await this.groupRepo.findOne({
      where: { id },
      relations: ['leader'],
    });
    if (!group) throw new NotFoundException('Small group not found');
    return group;
  }
}
