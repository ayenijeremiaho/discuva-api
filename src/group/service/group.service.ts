import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { Group } from '../entity/group.entity';
import { GroupMember } from '../entity/group-member.entity';
import { Member } from '../../member/entity/member.entity';
import { FirstTimer } from '../../follow-up/entity/first-timer.entity';
import { CreateGroupDto, UpdateGroupDto } from '../dto/create-group.dto';
import {
  AddFirstTimersToGroupDto,
  AddGroupMemberDto,
  AddPhoneGroupMembersDto,
  BulkAddGroupMembersDto,
  BulkRemoveGroupEntriesDto,
  BulkRemoveGroupMembersDto,
} from '../dto/group-member.dto';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';

@Injectable()
export class GroupService {
  constructor(
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    @InjectRepository(GroupMember)
    private readonly groupMemberRepo: Repository<GroupMember>,
    @InjectRepository(FirstTimer)
    private readonly firstTimerRepo: Repository<FirstTimer>,
    private readonly auditLogService: AuditLogService,
  ) {}

  private readonly logger = new Logger(GroupService.name);

  async create(dto: CreateGroupDto, actorId: string): Promise<Group> {
    const existing = await this.groupRepo.findOne({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException('A group with this name already exists');
    }

    const group = this.groupRepo.create({
      name: dto.name,
      description: dto.description ?? null,
      createdBy: { id: actorId } as Member,
    });
    const saved = await this.groupRepo.save(group);
    this.logger.log(
      `Group "${saved.name}" created (id: ${saved.id}) by actor ${actorId}`,
    );
    this.auditLogService.log('GROUP_CREATED', {
      actorId,
      targetId: saved.id,
      metadata: { name: saved.name },
    });
    return saved;
  }

  async update(
    id: string,
    dto: UpdateGroupDto,
    actorId: string,
  ): Promise<Group> {
    const group = await this.getOrThrow(id);

    if (dto.name !== undefined && dto.name !== group.name) {
      const existing = await this.groupRepo.findOne({
        where: { name: dto.name },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException('A group with this name already exists');
      }
      group.name = dto.name;
    }
    if (dto.description !== undefined) group.description = dto.description;

    const saved = await this.groupRepo.save(group);
    this.auditLogService.log('GROUP_UPDATED', {
      actorId,
      targetId: id,
      metadata: { name: saved.name, changes: Object.keys(dto) },
    });
    return saved;
  }

  async delete(id: string, actorId: string): Promise<void> {
    const group = await this.getOrThrow(id);
    const { name } = group;
    await this.groupRepo.remove(group);
    this.auditLogService.log('GROUP_DELETED', {
      actorId,
      targetId: id,
      metadata: { name },
    });
  }

  async getLookup(): Promise<Pick<Group, 'id' | 'name'>[]> {
    return this.groupRepo.find({
      select: ['id', 'name'],
      order: { name: 'ASC' },
    });
  }

  async getAll(): Promise<(Group & { memberCount: number })[]> {
    const groups = await this.groupRepo
      .createQueryBuilder('group')
      .leftJoinAndSelect('group.createdBy', 'createdBy')
      .loadRelationCountAndMap('group.memberCount', 'group.members')
      .orderBy('group.name', 'ASC')
      .getMany();
    return groups as (Group & { memberCount: number })[];
  }

  async getById(id: string): Promise<Group & { memberCount: number }> {
    const group = await this.groupRepo
      .createQueryBuilder('group')
      .leftJoinAndSelect('group.createdBy', 'createdBy')
      .loadRelationCountAndMap('group.memberCount', 'group.members')
      .where('group.id = :id', { id })
      .getOne();
    if (!group) throw new NotFoundException('Group not found');
    return group as Group & { memberCount: number };
  }

  async getMembers(
    groupId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginationResponseDto<GroupMember>> {
    await this.getOrThrow(groupId);

    const [data, total] = await this.groupMemberRepo
      .createQueryBuilder('gm')
      .leftJoinAndSelect('gm.member', 'member')
      .where('gm.group_id = :groupId', { groupId })
      .orderBy('member.firstname', 'ASC')
      .addOrderBy('gm.label', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async addMember(
    groupId: string,
    dto: AddGroupMemberDto,
    actorId: string,
  ): Promise<GroupMember> {
    await this.getOrThrow(groupId);

    const existing = await this.groupMemberRepo.findOne({
      where: { group: { id: groupId }, member: { id: dto.memberId } },
    });
    if (existing) {
      throw new ConflictException('Member is already in this group');
    }

    const groupMember = this.groupMemberRepo.create({
      group: { id: groupId } as Group,
      member: { id: dto.memberId } as Member,
      addedBy: { id: actorId } as Member,
    });
    const saved = await this.groupMemberRepo.save(groupMember);
    this.auditLogService.log('GROUP_MEMBERS_ADDED', {
      actorId,
      targetId: groupId,
      metadata: { memberIds: [dto.memberId] },
    });
    return saved;
  }

  async bulkAddMembers(
    groupId: string,
    dto: BulkAddGroupMembersDto,
    actorId: string,
  ): Promise<{ added: number; skipped: number }> {
    await this.getOrThrow(groupId);

    // Batched instead of looping addMember() per id (which cost 2 round
    // trips per member) — one existence check + one bulk insert regardless
    // of how many ids are submitted.
    const uniqueIds = Array.from(new Set(dto.memberIds));
    const existingRows = await this.groupMemberRepo
      .createQueryBuilder('gm')
      .select('gm.member_id', 'memberId')
      .where('gm.group_id = :groupId', { groupId })
      .andWhere('gm.member_id IN (:...ids)', { ids: uniqueIds })
      .getRawMany<{ memberId: string }>();
    const existingIds = new Set(existingRows.map((r) => r.memberId));

    const toAdd = uniqueIds.filter((id) => !existingIds.has(id));
    const skipped = uniqueIds.length - toAdd.length;

    if (toAdd.length > 0) {
      await this.groupMemberRepo.save(
        toAdd.map((memberId) =>
          this.groupMemberRepo.create({
            group: { id: groupId } as Group,
            member: { id: memberId } as Member,
            addedBy: { id: actorId } as Member,
          }),
        ),
      );
      this.auditLogService.log('GROUP_MEMBERS_ADDED', {
        actorId,
        targetId: groupId,
        metadata: { memberIds: toAdd },
      });
    }

    this.logger.log(
      `Bulk add to group ${groupId}: ${toAdd.length} added, ${skipped} skipped`,
    );
    return { added: toAdd.length, skipped };
  }

  async removeMember(
    groupId: string,
    memberId: string,
    actorId: string,
  ): Promise<void> {
    const groupMember = await this.groupMemberRepo.findOne({
      where: { group: { id: groupId }, member: { id: memberId } },
    });
    if (!groupMember) {
      throw new NotFoundException('Member is not in this group');
    }
    await this.groupMemberRepo.remove(groupMember);
    this.auditLogService.log('GROUP_MEMBERS_REMOVED', {
      actorId,
      targetId: groupId,
      metadata: { memberIds: [memberId] },
    });
  }

  async bulkRemoveMembers(
    groupId: string,
    dto: BulkRemoveGroupMembersDto,
    actorId: string,
  ): Promise<{ removed: number }> {
    await this.getOrThrow(groupId);

    const result = await this.groupMemberRepo.delete({
      group: { id: groupId },
      member: { id: In(dto.memberIds) },
    });
    const removed = result.affected ?? 0;
    this.auditLogService.log('GROUP_MEMBERS_REMOVED', {
      actorId,
      targetId: groupId,
      metadata: { memberIds: dto.memberIds },
    });
    this.logger.log(`Bulk remove from group ${groupId}: ${removed} removed`);
    return { removed };
  }

  async getMemberIdsForGroup(groupId: string): Promise<string[]> {
    const rows = await this.groupMemberRepo
      .createQueryBuilder('gm')
      .select('gm.member_id', 'memberId')
      .where('gm.group_id = :groupId', { groupId })
      .andWhere('gm.member_id IS NOT NULL')
      .getRawMany<{ memberId: string }>();
    return rows.map((r) => r.memberId);
  }

  async getPhoneOnlyNumbersForGroup(groupId: string): Promise<string[]> {
    const rows = await this.groupMemberRepo.find({
      where: { group: { id: groupId }, phoneNumber: Not(IsNull()) },
    });
    return rows.map((r) => r.phoneNumber).filter((p): p is string => !!p);
  }

  async addPhoneEntries(
    groupId: string,
    dto: AddPhoneGroupMembersDto,
    actorId: string,
  ): Promise<{ added: number; skipped: number }> {
    await this.getOrThrow(groupId);

    // Batched instead of looping a findOne+save per entry — one existence
    // check + one bulk insert regardless of how many entries are submitted
    // (matters most for the first-timers bulk import below, which can hand
    // this dozens of entries at once).
    const phoneNumbers = dto.entries.map((e) => e.phoneNumber);
    const existingRows = await this.groupMemberRepo
      .createQueryBuilder('gm')
      .select('gm.phone_number', 'phoneNumber')
      .where('gm.group_id = :groupId', { groupId })
      .andWhere('gm.phone_number IN (:...phoneNumbers)', { phoneNumbers })
      .getRawMany<{ phoneNumber: string }>();
    const existingSet = new Set(existingRows.map((r) => r.phoneNumber));

    const seen = new Set<string>();
    const toAdd = dto.entries.filter((entry) => {
      if (existingSet.has(entry.phoneNumber) || seen.has(entry.phoneNumber)) {
        return false;
      }
      seen.add(entry.phoneNumber);
      return true;
    });
    const skipped = dto.entries.length - toAdd.length;

    if (toAdd.length > 0) {
      await this.groupMemberRepo.save(
        toAdd.map((entry) =>
          this.groupMemberRepo.create({
            group: { id: groupId } as Group,
            phoneNumber: entry.phoneNumber,
            label: entry.label ?? null,
            addedBy: { id: actorId } as Member,
          }),
        ),
      );
      this.auditLogService.log('GROUP_MEMBERS_ADDED', {
        actorId,
        targetId: groupId,
        metadata: { added: toAdd.length, skipped, source: 'manual-phone' },
      });
    }

    this.logger.log(
      `Phone-entry add to group ${groupId}: ${toAdd.length} added, ${skipped} skipped`,
    );
    return { added: toAdd.length, skipped };
  }

  async addFirstTimersToGroup(
    groupId: string,
    dto: AddFirstTimersToGroupDto,
    actorId: string,
  ): Promise<{ added: number; skipped: number }> {
    await this.getOrThrow(groupId);

    const firstTimers = await this.firstTimerRepo
      .createQueryBuilder('ft')
      .where('ft.createdAt >= :dateFrom', { dateFrom: dto.dateFrom })
      .andWhere('ft.createdAt <= :dateTo', { dateTo: dto.dateTo })
      .getMany();

    const entries = firstTimers
      .filter((ft) => !!ft.phone)
      .map((ft) => ({
        phoneNumber: ft.phone,
        label: `${ft.firstname} ${ft.lastname}`.trim(),
      }));

    if (entries.length === 0) {
      return { added: 0, skipped: 0 };
    }

    const result = await this.addPhoneEntries(groupId, { entries }, actorId);
    this.auditLogService.log('GROUP_MEMBERS_ADDED', {
      actorId,
      targetId: groupId,
      metadata: {
        added: result.added,
        skipped: result.skipped,
        source: 'first-timers',
        dateFrom: dto.dateFrom,
        dateTo: dto.dateTo,
      },
    });
    return result;
  }

  async removeEntry(
    groupId: string,
    entryId: string,
    actorId: string,
  ): Promise<void> {
    const groupMember = await this.groupMemberRepo.findOne({
      where: { id: entryId, group: { id: groupId } },
    });
    if (!groupMember) {
      throw new NotFoundException('Entry is not in this group');
    }
    await this.groupMemberRepo.remove(groupMember);
    this.auditLogService.log('GROUP_MEMBERS_REMOVED', {
      actorId,
      targetId: groupId,
      metadata: { entryIds: [entryId] },
    });
  }

  async bulkRemoveEntries(
    groupId: string,
    dto: BulkRemoveGroupEntriesDto,
    actorId: string,
  ): Promise<{ removed: number }> {
    await this.getOrThrow(groupId);

    const result = await this.groupMemberRepo.delete({
      group: { id: groupId },
      id: In(dto.entryIds),
    });
    const removed = result.affected ?? 0;
    this.auditLogService.log('GROUP_MEMBERS_REMOVED', {
      actorId,
      targetId: groupId,
      metadata: { entryIds: dto.entryIds },
    });
    this.logger.log(`Bulk remove from group ${groupId}: ${removed} removed`);
    return { removed };
  }

  private async getOrThrow(id: string): Promise<Group> {
    const group = await this.groupRepo.findOne({ where: { id } });
    if (!group) throw new NotFoundException('Group not found');
    return group;
  }
}
