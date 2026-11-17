import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChildRoomDuty } from '../entity/child-room-duty.entity';
import { ChildClassGroup } from '../entity/child-class-group.entity';
import { ChildAgeGroup } from '../entity/child-age-group.entity';
import { ChildProfile } from '../entity/child-profile.entity';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { ChurchTimezoneService } from '../../utility/service/church-timezone.service';
import { CacheService } from '../../utility/service/cache.service';
import { churchDay } from '../church-day';
import { childAgeInMonths } from '../child-age.util';
import { ChildCheckInNoteService } from './child-checkin-note.service';
import { ChildrenChurchDashboardService } from './children-church-dashboard.service';
import { ChildrenChurchService } from './children-church.service';
import {
  CreateChildAgeGroupDto,
  UpdateChildAgeGroupDto,
} from '../dto/create-age-group.dto';
import {
  CreateChildClassGroupDto,
  UpdateChildClassGroupDto,
} from '../dto/create-class-group.dto';

// The room each team member serves in today, and the HOD's one-time groups and rooms setup.
@Injectable()
export class ChildRoomService {
  constructor(
    @InjectRepository(ChildRoomDuty)
    private readonly dutyRepo: Repository<ChildRoomDuty>,
    @InjectRepository(ChildClassGroup)
    private readonly classGroupRepo: Repository<ChildClassGroup>,
    @InjectRepository(ChildAgeGroup)
    private readonly ageGroupRepo: Repository<ChildAgeGroup>,
    @InjectRepository(ChildProfile)
    private readonly childRepo: Repository<ChildProfile>,
    private readonly tz: ChurchTimezoneService,
    private readonly cache: CacheService,
    private readonly team: ChildCheckInNoteService,
    private readonly dashboard: ChildrenChurchDashboardService,
    private readonly children: ChildrenChurchService,
  ) {}

  // ─── Today's room ─────────────────────────────────────────────────────────

  // Asked once; after that last week's room carries over until they change it.
  async myDuty(user: MemberAuth) {
    await this.team.requireTeam(user);
    const { ymd } = churchDay(await this.tz.get());
    const [last, rooms, here] = await Promise.all([
      this.dutyRepo.findOne({
        where: { member: { id: user.id } },
        relations: ['classGroup'],
        select: { id: true, day: true, classGroup: { id: true, name: true } },
        order: { day: 'DESC' },
      }),
      this.classGroupRepo.find({
        relations: ['ageGroup'],
        select: {
          id: true,
          name: true,
          ageGroup: { id: true, minAgeMonths: true, maxAgeMonths: true },
        },
        order: { name: 'ASC' },
      }),
      this.dutyRepo
        .createQueryBuilder('d')
        .innerJoin('d.member', 'm')
        .select('d.class_group_id', 'classGroupId')
        .addSelect('m.firstname', 'firstname')
        .where('d.day = :ymd', { ymd })
        .andWhere('d.member_id != :me', { me: user.id })
        .getRawMany<{ classGroupId: string | null; firstname: string }>(),
    ]);

    const remembered = !!last && last.day !== ymd;
    if (last && remembered)
      await this.save(user.id, ymd, last.classGroup?.id ?? null);

    return {
      duty: last
        ? {
            classGroupId: last.classGroup?.id ?? null,
            roomName: last.classGroup?.name ?? null,
            frontDesk: !last.classGroup,
            remembered,
          }
        : null,
      rooms: rooms.map((r) => ({
        id: r.id,
        name: r.name,
        minAgeMonths: r.ageGroup?.minAgeMonths ?? null,
        maxAgeMonths: r.ageGroup?.maxAgeMonths ?? null,
        here: here
          .filter((h) => h.classGroupId === r.id)
          .map((h) => h.firstname),
      })),
      atFrontDesk: here.filter((h) => !h.classGroupId).map((h) => h.firstname),
    };
  }

  async setDuty(user: MemberAuth, classGroupId: string | null) {
    await this.team.requireTeam(user);
    let room: ChildClassGroup | null = null;
    if (classGroupId) {
      room = await this.classGroupRepo.findOne({
        where: { id: classGroupId },
        select: { id: true, name: true },
      });
      if (!room) throw new NotFoundException('Room not found');
    }
    const { ymd } = churchDay(await this.tz.get());
    await this.save(user.id, ymd, room?.id ?? null);
    return {
      classGroupId: room?.id ?? null,
      roomName: room?.name ?? null,
      frontDesk: !room,
      remembered: false,
    };
  }

  private async save(
    memberId: string,
    day: string,
    classGroupId: string | null,
  ): Promise<void> {
    await this.dutyRepo.query(
      `INSERT INTO child_room_duties (member_id, class_group_id, day) VALUES ($1, $2, $3)
       ON CONFLICT (member_id, day) DO UPDATE SET class_group_id = EXCLUDED.class_group_id, updated_at = now()`,
      [memberId, classGroupId, day],
    );
    this.cache.del(this.cache.key('cc-dashboard', day));
  }

  // ─── Groups & rooms (HOD and deputy) ──────────────────────────────────────

  async setup(user: MemberAuth) {
    await this.requireLead(user);
    const [groups, rooms, counts, children] = await Promise.all([
      this.ageGroupRepo.find({
        order: { displayOrder: 'ASC', minAgeMonths: 'ASC' },
      }),
      this.classGroupRepo.find({
        relations: ['ageGroup'],
        select: {
          id: true,
          name: true,
          capacity: true,
          childrenPerTeacher: true,
          ageGroup: { id: true },
        },
        order: { name: 'ASC' },
      }),
      this.childRepo
        .createQueryBuilder('c')
        .select('c.age_group_id', 'ageGroupId')
        .addSelect('c.class_group_id', 'classGroupId')
        .addSelect('COUNT(*)::int', 'n')
        .groupBy('c.age_group_id')
        .addGroupBy('c.class_group_id')
        .getRawMany<{
          ageGroupId: string | null;
          classGroupId: string | null;
          n: number;
        }>(),
      this.childRepo.find({
        relations: ['ageGroup'],
        select: {
          id: true,
          dateOfBirth: true,
          ageRange: true,
          ageRangeSetOn: true,
          ageGroup: { id: true },
        },
      }),
    ]);

    // Children whose age now puts them in a different group: what "Move them?" would change.
    const today = new Date();
    const toMove = children.filter((c) => {
      const months = childAgeInMonths(c, today);
      const fits =
        months === null
          ? null
          : (groups.find(
              (g) => g.minAgeMonths <= months && g.maxAgeMonths >= months,
            )?.id ?? null);
      return (c.ageGroup?.id ?? null) !== fits;
    }).length;

    return {
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        minAgeMonths: g.minAgeMonths,
        maxAgeMonths: g.maxAgeMonths,
        displayOrder: g.displayOrder,
        children: counts
          .filter((c) => c.ageGroupId === g.id)
          .reduce((n, c) => n + Number(c.n), 0),
        rooms: rooms
          .filter((r) => r.ageGroup?.id === g.id)
          .map((r) => ({
            id: r.id,
            name: r.name,
            capacity: r.capacity,
            childrenPerTeacher: r.childrenPerTeacher,
            children: counts
              .filter((c) => c.classGroupId === r.id)
              .reduce((n, c) => n + Number(c.n), 0),
          })),
      })),
      toMove,
    };
  }

  async addGroup(user: MemberAuth, dto: CreateChildAgeGroupDto) {
    await this.requireLead(user);
    return this.children.createAgeGroup(dto);
  }

  async updateGroup(user: MemberAuth, id: string, dto: UpdateChildAgeGroupDto) {
    await this.requireLead(user);
    return this.children.updateAgeGroup(id, dto);
  }

  async deleteGroup(user: MemberAuth, id: string) {
    await this.requireLead(user);
    return this.children.deleteAgeGroup(id);
  }

  async addRoom(user: MemberAuth, dto: CreateChildClassGroupDto) {
    await this.requireLead(user);
    return this.children.createClassGroup(dto);
  }

  async updateRoom(
    user: MemberAuth,
    id: string,
    dto: UpdateChildClassGroupDto,
  ) {
    await this.requireLead(user);
    return this.children.updateClassGroup(id, dto);
  }

  async deleteRoom(user: MemberAuth, id: string) {
    await this.requireLead(user);
    return this.children.deleteClassGroup(id);
  }

  async regroup(user: MemberAuth) {
    await this.requireLead(user);
    return this.children.batchRecomputeAgeGroups();
  }

  private async requireLead(user: MemberAuth) {
    if (!(await this.dashboard.isLead(user.id))) {
      throw new ForbiddenException(
        "Only the head of the Children's Church department can change groups and rooms.",
      );
    }
  }
}
