import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { ChildProfile } from '../entity/child-profile.entity';
import { ChildGuardian } from '../entity/child-guardian.entity';
import { ChildCheckIn } from '../entity/child-check-in.entity';
import { Member } from '../../member/entity/member.entity';
import { CreateGuardianDto } from '../dto/create-guardian.dto';
import { ChildrenChurchService } from './children-church.service';
import { MemberService } from '../../member/service/member.service';
import { UtilityService } from '../../utility/service/utility.service';
import { personName } from '../church-day';

export type ParentLinkFilter = 'linked' | 'unlinked';

// Oversight for church admins: every child, their guardians, and who handled each visit.
@Injectable()
export class ChildrenChurchAdminService {
  constructor(
    @InjectRepository(ChildProfile)
    private readonly childRepo: Repository<ChildProfile>,
    @InjectRepository(ChildGuardian)
    private readonly guardianRepo: Repository<ChildGuardian>,
    @InjectRepository(ChildCheckIn)
    private readonly checkInRepo: Repository<ChildCheckIn>,
    private readonly children: ChildrenChurchService,
    private readonly members: MemberService,
  ) {}

  async list(opts: {
    search?: string;
    classGroupId?: string;
    link?: ParentLinkFilter;
    page: number;
    limit: number;
  }) {
    const page = Math.max(1, opts.page);
    const limit = Math.min(Math.max(1, opts.limit), 50);
    const linked = `EXISTS (SELECT 1 FROM child_guardians lg WHERE lg.child_id = c.id AND lg.member_id IS NOT NULL)`;

    const qb = this.childRepo
      .createQueryBuilder('c')
      .leftJoin('c.classGroup', 'cg')
      .leftJoin('c.registeredBy', 'rb')
      .select([
        'c.id',
        'c.firstname',
        'c.lastname',
        'c.dateOfBirth',
        'c.ageRange',
        'c.ageRangeSetOn',
        'c.staysAllServices',
        'c.createdAt',
        'cg.id',
        'cg.name',
        'rb.id',
        'rb.firstname',
        'rb.lastname',
      ])
      .orderBy('c.lastname', 'ASC')
      .addOrderBy('c.firstname', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    const term = opts.search?.trim();
    if (term) {
      qb.andWhere(
        new Brackets((w) =>
          w
            .where(`CONCAT(c.firstname, ' ', c.lastname) ILIKE :term`)
            .orWhere(
              `EXISTS (SELECT 1 FROM child_guardians sg WHERE sg.child_id = c.id AND sg.full_name ILIKE :term)`,
            ),
        ),
        { term: `%${term}%` },
      );
    }
    if (opts.classGroupId) {
      qb.andWhere('cg.id = :classGroupId', { classGroupId: opts.classGroupId });
    }
    if (opts.link === 'linked') qb.andWhere(linked);
    if (opts.link === 'unlinked') qb.andWhere(`NOT ${linked}`);

    const [rows, total] = await qb.getManyAndCount();
    const ids = rows.map((r) => r.id);

    const [guardians, lastVisits, counts] = await Promise.all([
      ids.length
        ? this.guardianRepo
            .createQueryBuilder('g')
            .select('g.child_id', 'childId')
            .addSelect('g.full_name', 'fullName')
            .addSelect('g.member_id IS NOT NULL', 'onApp')
            .where('g.child_id IN (:...ids)', { ids })
            .orderBy('g.created_at', 'ASC')
            .getRawMany<{ childId: string; fullName: string; onApp: boolean }>()
        : [],
      ids.length
        ? this.checkInRepo
            .createQueryBuilder('ci')
            .select('ci.child_id', 'childId')
            .addSelect('MAX(ci.checkin_time)', 'last')
            .where('ci.child_id IN (:...ids)', { ids })
            .groupBy('ci.child_id')
            .getRawMany<{ childId: string; last: Date }>()
        : [],
      this.counts(),
    ]);

    const data = rows.map((c) => {
      const mine = guardians.filter((g) => g.childId === c.id);
      return {
        id: c.id,
        firstname: c.firstname,
        lastname: c.lastname,
        dateOfBirth: c.dateOfBirth,
        ageRange: c.ageRange,
        ageRangeSetOn: c.ageRangeSetOn,
        staysAllServices: c.staysAllServices,
        classGroup: c.classGroup,
        createdAt: c.createdAt,
        registeredBy: personName(c.registeredBy),
        guardians: mine.map((g) => g.fullName),
        guardiansOnApp: mine.filter((g) => g.onApp).length,
        lastVisit: lastVisits.find((v) => v.childId === c.id)?.last ?? null,
      };
    });
    return {
      ...UtilityService.createPaginationResponse(data, page, limit, total),
      counts,
    };
  }

  async detail(childId: string) {
    const child = await this.childRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.classGroup', 'cg')
      .leftJoinAndSelect('c.ageGroup', 'ag')
      .leftJoin('c.registeredBy', 'rb')
      .addSelect(['rb.id', 'rb.firstname', 'rb.lastname'])
      .leftJoin('c.notesUpdatedBy', 'nub')
      .addSelect(['nub.id', 'nub.firstname', 'nub.lastname'])
      .where('c.id = :childId', { childId })
      .getOne();
    if (!child) throw new NotFoundException('Child not found');

    const [guardians, visits] = await Promise.all([
      this.guardianRepo.find({
        where: { child: { id: childId } },
        relations: ['member'],
        select: {
          id: true,
          createdAt: true,
          fullName: true,
          relationship: true,
          phoneNumber: true,
          email: true,
          isAuthorizedPickup: true,
          member: { id: true, firstname: true, lastname: true },
        },
        order: { createdAt: 'ASC' },
      }),
      this.checkInRepo
        .createQueryBuilder('ci')
        .leftJoin('ci.checkedInBy', 'tin')
        .addSelect(['tin.id', 'tin.firstname', 'tin.lastname'])
        .leftJoin('ci.checkedOutBy', 'tout')
        .addSelect(['tout.id', 'tout.firstname', 'tout.lastname'])
        .leftJoin('ci.serviceSlot', 'slot')
        .addSelect(['slot.id', 'slot.name'])
        .where('ci.child_id = :childId', { childId })
        .orderBy('ci.checkinTime', 'DESC')
        .take(20)
        .getMany(),
    ]);

    return {
      child: {
        ...child,
        registeredBy: personName(child.registeredBy),
        notesUpdatedBy: personName(child.notesUpdatedBy),
      },
      guardians: guardians.map((g) => ({
        id: g.id,
        fullName: g.fullName,
        relationship: g.relationship,
        phoneNumber: g.phoneNumber,
        email: g.email,
        isAuthorizedPickup: g.isAuthorizedPickup,
        member: g.member
          ? { id: g.member.id, name: personName(g.member) }
          : null,
      })),
      visits: visits.map((v) => ({
        id: v.id,
        status: v.status,
        checkinTime: v.checkinTime,
        checkoutTime: v.checkoutTime,
        serviceName: v.serviceSlot?.name ?? null,
        droppedOffByName: v.droppedOffByName,
        pickedUpByName: v.pickedUpByName,
        receivedBy: personName(v.checkedInBy),
        handedBackBy: personName(v.checkedOutBy),
        flagReason: v.flagReason,
      })),
    };
  }

  async addGuardian(childId: string, dto: CreateGuardianDto) {
    const child = await this.childRepo.findOne({ where: { id: childId } });
    if (!child) throw new NotFoundException('Child not found');
    if (dto.memberId) await this.assertNotGuardian(childId, dto.memberId);
    await this.guardianRepo.save(this.children.guardianEntity(child, dto));
    return this.detail(childId);
  }

  async linkGuardian(guardianId: string, memberId: string | null) {
    const guardian = await this.guardianRepo.findOne({
      where: { id: guardianId },
      relations: ['child'],
      select: { id: true, child: { id: true } },
    });
    if (!guardian) throw new NotFoundException('Guardian not found');
    if (memberId) await this.assertNotGuardian(guardian.child.id, memberId);
    await this.guardianRepo.update(guardianId, {
      member: memberId ? ({ id: memberId } as Member) : null,
    });
    return this.detail(guardian.child.id);
  }

  async removeGuardian(guardianId: string) {
    const guardian = await this.guardianRepo.findOne({
      where: { id: guardianId },
      relations: ['child'],
      select: { id: true, child: { id: true } },
    });
    if (!guardian) throw new NotFoundException('Guardian not found');
    await this.guardianRepo.delete(guardianId);
    return this.detail(guardian.child.id);
  }

  async updateNotes(childId: string, specialNotes: string | null) {
    const res = await this.childRepo.update(childId, {
      specialNotes: specialNotes?.trim() || null,
    });
    if (!res.affected) throw new NotFoundException('Child not found');
    return this.detail(childId);
  }

  // Everyone who checked a child in or out in the last 90 days, for the history filter.
  async teachers(): Promise<{ id: string; name: string }[]> {
    const rows = (await this.checkInRepo.query(
      `SELECT m.id, m.firstname, m.lastname FROM members m
       WHERE m.id IN (
         SELECT checked_in_by_id FROM child_check_ins WHERE checkin_time >= $1 AND checked_in_by_id IS NOT NULL
         UNION
         SELECT checked_out_by_id FROM child_check_ins WHERE checkin_time >= $1 AND checked_out_by_id IS NOT NULL
       )
       ORDER BY m.firstname, m.lastname`,
      [new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)],
    )) as { id: string; firstname: string; lastname: string }[];
    return rows.map((r) => ({ id: r.id, name: personName(r) ?? '' }));
  }

  searchMembers(q: string) {
    return this.members.searchActiveMembersLite(q);
  }

  private async counts() {
    const [row] = (await this.childRepo.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM child_guardians g WHERE g.child_id = c.id AND g.member_id IS NOT NULL
              ))::int AS linked
       FROM child_profiles c`,
    )) as { total: number; linked: number }[];
    return {
      total: row?.total ?? 0,
      linked: row?.linked ?? 0,
      unlinked: (row?.total ?? 0) - (row?.linked ?? 0),
    };
  }

  private async assertNotGuardian(childId: string, memberId: string) {
    const exists = await this.guardianRepo.exists({
      where: { child: { id: childId }, member: { id: memberId } },
    });
    if (exists) {
      throw new BadRequestException(
        'This member is already a guardian of this child',
      );
    }
  }
}
