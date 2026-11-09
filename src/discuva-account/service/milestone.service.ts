import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { Repository } from 'typeorm';
import { DiscuvaMilestone } from '../entity/discuva-milestone.entity';
import {
  MilestoneSource,
  MilestoneType,
  MilestoneVisibility,
} from '../enum/milestone.enum';
import { DiscuvaProfileService } from './discuva-profile.service';
import { DiscuvaAccountService } from './discuva-account.service';
import { Member } from '../../member/entity/member.entity';
import { ClassEnrollment } from '../../classes/entity/class-enrollment.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { UtilityService } from '../../utility/service/utility.service';

export interface MilestoneInput {
  type?: MilestoneType;
  title?: string | null;
  month?: number | null;
  year?: number | null;
  placeName?: string | null;
  visibility?: MilestoneVisibility;
  hidden?: boolean;
}

type Owner = Pick<Member, 'id' | 'discuvaAccountId'>;

// The church copies still carry these years, so existing reports keep working.
const CHURCH_YEAR_FIELD: Partial<
  Record<MilestoneType, 'yearBornAgain' | 'yearBaptized'>
> = {
  [MilestoneType.SALVATION]: 'yearBornAgain',
  [MilestoneType.BAPTISM]: 'yearBaptized',
};

const BAPTISM_REF = 'baptism';
const enrollmentRef = (id: string) => `enrollment:${id}`;

@Injectable()
export class MilestoneService {
  constructor(
    @InjectRepository(DiscuvaMilestone)
    private readonly milestoneRepo: Repository<DiscuvaMilestone>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    @InjectRepository(ClassEnrollment)
    private readonly enrollmentRepo: Repository<ClassEnrollment>,
    private readonly profiles: DiscuvaProfileService,
    private readonly accounts: DiscuvaAccountService,
    private readonly utilityService: UtilityService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async listMine(memberId: string): Promise<DiscuvaMilestone[]> {
    const accountId = await this.ownerOrThrow(await this.load(memberId));
    return this.listFor(accountId);
  }

  // What this church's admins may see: not private, not hidden by the person.
  async listForChurch(memberId: string): Promise<DiscuvaMilestone[]> {
    const accountId = await this.profiles.ownerOf(await this.load(memberId));
    if (!accountId) return [];
    return (await this.listFor(accountId)).filter(
      (m) => m.visibility === MilestoneVisibility.CHURCHES && !m.hidden,
    );
  }

  async create(
    memberId: string,
    input: MilestoneInput,
  ): Promise<DiscuvaMilestone> {
    const member = await this.load(memberId);
    const accountId = await this.ownerOrThrow(member);
    if (!input.type)
      throw new BadRequestException('Choose a kind of milestone.');
    const milestone = this.milestoneRepo.create({
      accountId,
      type: input.type,
      title: input.title ?? null,
      month: input.month ?? null,
      year: input.year ?? null,
      placeName: input.placeName ?? null,
      visibility: input.visibility ?? MilestoneVisibility.CHURCHES,
      source: MilestoneSource.MEMBER,
    });
    this.assertComplete(milestone);
    const saved = await this.milestoneRepo.save(milestone);
    await this.shareYearWithChurches(member, saved);
    return saved;
  }

  // A church-recorded milestone can be hidden or kept private, never rewritten.
  async update(
    memberId: string,
    id: string,
    input: MilestoneInput,
  ): Promise<DiscuvaMilestone> {
    const member = await this.load(memberId);
    const milestone = await this.mine(member, id);
    const { visibility, hidden, ...content } = input;
    if (visibility !== undefined) milestone.visibility = visibility;
    if (hidden !== undefined) milestone.hidden = hidden;
    const changesContent = Object.values(content).some((v) => v !== undefined);
    if (changesContent) {
      if (milestone.source === MilestoneSource.CHURCH) {
        throw new ForbiddenException(
          `${milestone.sourceName ?? 'Your church'} recorded this milestone, so it can't be changed. You can hide it instead.`,
        );
      }
      for (const [key, value] of Object.entries(content)) {
        if (value !== undefined) Object.assign(milestone, { [key]: value });
      }
      this.assertComplete(milestone);
    }
    const saved = await this.milestoneRepo.save(milestone);
    if (changesContent) await this.shareYearWithChurches(member, saved);
    return saved;
  }

  async remove(memberId: string, id: string): Promise<void> {
    const milestone = await this.mine(await this.load(memberId), id);
    if (milestone.source === MilestoneSource.CHURCH) {
      throw new ForbiddenException(
        "A milestone your church recorded can't be deleted. You can hide it instead.",
      );
    }
    await this.milestoneRepo.delete(milestone.id);
  }

  // Classes marked as a membership class or workers' training add a milestone when someone completes them.
  async recordClassCompletions(enrollmentIds: string[]): Promise<void> {
    if (!enrollmentIds.length) return;
    const rows: {
      id: string;
      completedAt: Date;
      accountId: string;
      countsAs: MilestoneType;
      className: string;
    }[] = await this.enrollmentRepo
      .createQueryBuilder('e')
      .innerJoin('e.member', 'm')
      .innerJoin('e.churchClass', 'c')
      .innerJoin('c.classType', 't')
      .select('e.id', 'id')
      .addSelect('e.completedAt', 'completedAt')
      .addSelect('m.discuvaAccountId', 'accountId')
      .addSelect('t.countsAs', 'countsAs')
      .addSelect('c.name', 'className')
      .where('e.id IN (:...ids)', { ids: enrollmentIds })
      .andWhere('m.discuvaAccountId IS NOT NULL')
      .andWhere('t.countsAs IS NOT NULL')
      .getRawMany();
    if (!rows.length || !(await this.accounts.isProfileOn())) return;
    const church = await this.church();
    await this.milestoneRepo
      .createQueryBuilder()
      .insert()
      .values(
        rows.map((r) => {
          const done = r.completedAt ? new Date(r.completedAt) : new Date();
          return {
            accountId: r.accountId,
            type: r.countsAs,
            title: r.className,
            month: done.getMonth() + 1,
            year: done.getFullYear(),
            ...church,
            sourceRef: enrollmentRef(r.id),
          };
        }),
      )
      .orIgnore()
      .execute();
  }

  // An admin records a baptism: always on the church record, and on the person's profile when they own one.
  async recordBaptism(
    memberId: string,
    when: { month?: number | null; year: number },
  ): Promise<void> {
    const member = await this.load(memberId);
    await this.memberRepo.update(memberId, {
      yearBaptized: new Date(`${when.year}-01-01`),
    });
    const accountId = await this.profiles.ownerOf(member);
    if (!accountId) return;
    const church = await this.church();
    const existing = await this.milestoneRepo.findOne({
      where: {
        accountId,
        sourceTenantId: church.sourceTenantId,
        sourceRef: BAPTISM_REF,
      },
    });
    await this.milestoneRepo.save(
      Object.assign(existing ?? this.milestoneRepo.create(), {
        accountId,
        type: MilestoneType.BAPTISM,
        month: when.month ?? null,
        year: when.year,
        ...church,
        sourceRef: BAPTISM_REF,
      }),
    );
  }

  private listFor(accountId: string): Promise<DiscuvaMilestone[]> {
    return this.milestoneRepo
      .createQueryBuilder('m')
      .where('m.accountId = :accountId', { accountId })
      .orderBy('m.year', 'DESC', 'NULLS LAST')
      .addOrderBy('m.month', 'DESC', 'NULLS LAST')
      .addOrderBy('m.createdAt', 'DESC')
      .getMany();
  }

  private async mine(member: Owner, id: string): Promise<DiscuvaMilestone> {
    const accountId = await this.ownerOrThrow(member);
    const milestone = await this.milestoneRepo.findOne({
      where: { id, accountId },
    });
    if (!milestone) throw new NotFoundException('Milestone not found');
    return milestone;
  }

  private async load(memberId: string): Promise<Owner> {
    const member = await this.memberRepo.findOne({
      where: { id: memberId },
      select: { id: true, discuvaAccountId: true },
    });
    if (!member) throw new NotFoundException('Member not found');
    return member;
  }

  private async ownerOrThrow(member: Owner): Promise<string> {
    const accountId = await this.profiles.ownerOf(member);
    if (!accountId) throw new NotFoundException('This is not available yet.');
    return accountId;
  }

  private async church() {
    const tenantId = this.cls.get('tenantId') ?? null;
    const name = await this.utilityService.resolveChurchName();
    return {
      placeTenantId: tenantId,
      placeName: name,
      source: MilestoneSource.CHURCH,
      sourceTenantId: tenantId,
      sourceName: name,
    };
  }

  private assertComplete(m: DiscuvaMilestone): void {
    if (m.type === MilestoneType.OTHER && !m.title?.trim()) {
      throw new BadRequestException('Give this milestone a name.');
    }
    if (m.month && !m.year) {
      throw new BadRequestException('Add the year as well as the month.');
    }
  }

  private async shareYearWithChurches(
    member: Owner,
    milestone: DiscuvaMilestone,
  ): Promise<void> {
    const field = CHURCH_YEAR_FIELD[milestone.type];
    if (!field || !milestone.year) return;
    await this.profiles.writeToChurches(member, {
      [field]: new Date(`${milestone.year}-01-01`),
    });
  }
}
