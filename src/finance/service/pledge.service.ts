import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PledgeContributionStatus, PledgeStatus } from '../enum/finance.enum';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Pledge } from '../entity/pledge.entity';
import { PledgeCampaign } from '../entity/pledge-campaign.entity';
import { PledgeContribution } from '../entity/pledge-contribution.entity';
import {
  CreatePledgeCampaignDto,
  CreatePledgeDto,
  MakePledgeDto,
  PledgeQueryDto,
  UpdateCampaignActiveDto,
  UpdatePledgeStatusDto,
} from '../dto/pledge.dto';
import {
  DeclinePledgeContributionDto,
  PledgeContributionQueryDto,
  SubmitPledgeContributionDto,
} from '../dto/pledge-contribution.dto';
import { Admin } from '../../admin/entity/admin.entity';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';

@Injectable()
export class PledgeService {
  constructor(
    @InjectRepository(Pledge)
    private readonly pledgeRepo: Repository<Pledge>,
    @InjectRepository(PledgeCampaign)
    private readonly campaignRepo: Repository<PledgeCampaign>,
    @InjectRepository(PledgeContribution)
    private readonly contributionRepo: Repository<PledgeContribution>,
    private readonly auditLogService: AuditLogService,
    private readonly utilityService: UtilityService,
  ) {}

  async createCampaign(
    dto: CreatePledgeCampaignDto,
    admin: Admin,
  ): Promise<PledgeCampaign> {
    const campaign = this.campaignRepo.create({
      name: dto.name,
      fund: { id: dto.fundId } as any,
      targetAmount: dto.targetAmount,
      startDate: dto.startDate,
      endDate: dto.endDate,
      description: dto.description ?? null,
      createdBy: { id: admin.id } as any,
    });
    const saved = await this.campaignRepo.save(campaign);
    this.auditLogService.log('PLEDGE_CAMPAIGN_CREATED', {
      actorId: admin.id,
      targetId: saved.id,
      metadata: { name: saved.name },
    });
    return saved;
  }

  async findAllCampaigns(): Promise<PledgeCampaign[]> {
    const { entities, raw } = await this.campaignRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.fund', 'fund')
      .addSelect(
        (sub) =>
          sub
            .select('COALESCE(SUM(p.total_amount), 0)')
            .from('finance_pledges', 'p')
            .where('p.campaign_id = c.id')
            .andWhere("p.status != 'CANCELLED'"),
        'totalPledged',
      )
      .addSelect(
        (sub) =>
          sub
            .select('COUNT(p.id)')
            .from('finance_pledges', 'p')
            .where('p.campaign_id = c.id')
            .andWhere("p.status != 'CANCELLED'"),
        'pledgeCount',
      )
      .addSelect(
        (sub) =>
          sub
            .select('COALESCE(SUM(pc.amount), 0)')
            .from('finance_pledges', 'p')
            .innerJoin(
              'finance_pledge_contributions',
              'pc',
              'pc.pledge_id = p.id',
            )
            .where('p.campaign_id = c.id')
            .andWhere("pc.status = 'CONFIRMED'"),
        'totalPaid',
      )
      .orderBy('c.start_date', 'DESC')
      .getRawAndEntities();

    return entities.map((entity, i) => {
      (entity as any).totalPledged = Number(raw[i]?.totalPledged ?? 0);
      (entity as any).pledgeCount = Number(raw[i]?.pledgeCount ?? 0);
      (entity as any).totalPaid = Number(raw[i]?.totalPaid ?? 0);
      return entity;
    });
  }

  async findActiveCampaignsForMembers(): Promise<
    {
      id: string;
      name: string;
      fundName: string | null;
      targetAmount: number;
      totalPledged: number;
      totalPaid: number;
      startDate: string;
      endDate: string;
      description: string | null;
    }[]
  > {
    const { entities, raw } = await this.campaignRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.fund', 'fund')
      .where('c.isActive = true')
      .andWhere('c.endDate >= CURRENT_DATE')
      .addSelect(
        (sub) =>
          sub
            .select('COALESCE(SUM(p.total_amount), 0)')
            .from('finance_pledges', 'p')
            .where('p.campaign_id = c.id')
            .andWhere("p.status != 'CANCELLED'"),
        'totalPledged',
      )
      .addSelect(
        (sub) =>
          sub
            .select('COALESCE(SUM(pc.amount), 0)')
            .from('finance_pledges', 'p')
            .innerJoin(
              'finance_pledge_contributions',
              'pc',
              'pc.pledge_id = p.id',
            )
            .where('p.campaign_id = c.id')
            .andWhere("pc.status = 'CONFIRMED'"),
        'totalPaid',
      )
      .orderBy('c.end_date', 'ASC')
      .getRawAndEntities();

    return entities.map((campaign, i) => ({
      id: campaign.id,
      name: campaign.name,
      fundName: campaign.fund?.name ?? null,
      targetAmount: Number(campaign.targetAmount),
      totalPledged: Number(raw[i]?.totalPledged ?? 0),
      totalPaid: Number(raw[i]?.totalPaid ?? 0),
      startDate: campaign.startDate,
      endDate: campaign.endDate,
      description: campaign.description,
    }));
  }

  async findOneCampaign(id: string): Promise<PledgeCampaign> {
    const campaign = await this.campaignRepo.findOne({
      where: { id },
      relations: ['fund', 'createdBy'],
    });
    if (!campaign) throw new NotFoundException('Pledge campaign not found.');
    return campaign;
  }

  async updateCampaignActive(
    id: string,
    dto: UpdateCampaignActiveDto,
    admin: Admin,
  ): Promise<PledgeCampaign> {
    const campaign = await this.findOneCampaign(id);
    campaign.isActive = dto.isActive;
    const saved = await this.campaignRepo.save(campaign);
    this.auditLogService.log('PLEDGE_CAMPAIGN_ACTIVE_UPDATED', {
      actorId: admin.id,
      targetId: saved.id,
      metadata: { isActive: dto.isActive },
    });
    return saved;
  }

  async createPledge(dto: CreatePledgeDto, admin: Admin): Promise<Pledge> {
    if (!dto.memberId && !dto.guestName)
      throw new BadRequestException(
        'Either memberId or guestName is required.',
      );
    await this.findOneCampaign(dto.campaignId);
    const pledge = this.pledgeRepo.create({
      member: dto.memberId ? ({ id: dto.memberId } as any) : null,
      guestName: dto.guestName ?? null,
      campaign: { id: dto.campaignId } as any,
      totalAmount: dto.totalAmount,
      frequency: dto.frequency,
      startDate: dto.startDate,
      notes: dto.notes ?? null,
    });
    const saved = await this.pledgeRepo.save(pledge);
    this.auditLogService.log('PLEDGE_CREATED', {
      actorId: admin.id,
      targetId: saved.id,
      metadata: {
        memberId: dto.memberId,
        guestName: dto.guestName,
        campaignId: dto.campaignId,
      },
    });
    return saved;
  }

  async findPledges(
    query: PledgeQueryDto,
  ): Promise<PaginationResponseDto<Pledge>> {
    const { page = 1, limit = 20, campaignId, memberId, status } = query;
    const qb = this.pledgeRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.member', 'member')
      .leftJoinAndSelect('p.campaign', 'campaign')
      .addSelect(
        (sub) =>
          sub
            .select('COALESCE(SUM(pc.amount), 0)')
            .from('finance_pledge_contributions', 'pc')
            .where('pc.pledge_id = p.id')
            .andWhere("pc.status = 'CONFIRMED'"),
        'amountPaid',
      )
      .orderBy('p.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (campaignId) qb.andWhere('campaign.id = :campaignId', { campaignId });
    if (memberId) qb.andWhere('member.id = :memberId', { memberId });
    if (status) qb.andWhere('p.status = :status', { status });

    const totalCount = await qb.getCount();
    const { entities, raw } = await qb.getRawAndEntities();
    const data = entities.map((entity, i) => {
      (entity as any).amountPaid = Number(raw[i]?.amountPaid ?? 0);
      return entity;
    });
    return {
      data,
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async updatePledgeStatus(
    id: string,
    dto: UpdatePledgeStatusDto,
    admin: Admin,
  ): Promise<Pledge> {
    const pledge = await this.pledgeRepo.findOne({ where: { id } });
    if (!pledge) throw new NotFoundException('Pledge not found.');
    if (
      pledge.status === PledgeStatus.COMPLETED ||
      pledge.status === PledgeStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `Pledge with status ${pledge.status} cannot be updated.`,
      );
    }
    pledge.status = dto.status;
    const saved = await this.pledgeRepo.save(pledge);
    this.auditLogService.log('PLEDGE_STATUS_UPDATED', {
      actorId: admin.id,
      targetId: saved.id,
      metadata: { status: dto.status },
    });
    return saved;
  }

  async memberMakePledge(
    memberId: string,
    dto: MakePledgeDto,
  ): Promise<Pledge> {
    await this.findOneCampaign(dto.campaignId);
    const pledge = this.pledgeRepo.create({
      member: { id: memberId } as any,
      campaign: { id: dto.campaignId } as any,
      totalAmount: dto.totalAmount,
      frequency: dto.frequency,
      startDate: dto.startDate,
      notes: dto.notes ?? null,
    });
    const saved = await this.pledgeRepo.save(pledge);
    this.auditLogService.log('PLEDGE_CREATED', {
      targetId: saved.id,
      metadata: {
        memberId,
        campaignId: dto.campaignId,
        source: 'member-self-service',
      },
    });
    return saved;
  }

  async getMemberPledges(memberId: string): Promise<Pledge[]> {
    const { entities, raw } = await this.pledgeRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.campaign', 'campaign')
      .leftJoinAndSelect('campaign.fund', 'fund')
      .leftJoin('p.member', 'member')
      .where('member.id = :memberId', { memberId })
      .addSelect(
        (sub) =>
          sub
            .select('COALESCE(SUM(pc.amount), 0)')
            .from('finance_pledge_contributions', 'pc')
            .where('pc.pledge_id = p.id')
            .andWhere("pc.status = 'CONFIRMED'"),
        'amountPaid',
      )
      .orderBy('p.createdAt', 'DESC')
      .getRawAndEntities();

    return entities.map((entity, i) => {
      (entity as any).amountPaid = Number(raw[i]?.amountPaid ?? 0);
      return entity;
    });
  }

  findActivePledgesForReminder(): Promise<Pledge[]> {
    return this.pledgeRepo.find({
      where: { status: PledgeStatus.ACTIVE },
      relations: ['member', 'campaign'],
    });
  }

  // ─── Pledge contributions (member-reported, admin-reviewed) ───────────────

  async submitContribution(
    memberId: string,
    pledgeId: string,
    dto: SubmitPledgeContributionDto,
  ): Promise<PledgeContribution> {
    const pledge = await this.pledgeRepo.findOne({
      where: { id: pledgeId },
      relations: ['member'],
    });
    if (!pledge) throw new NotFoundException('Pledge not found.');
    if (pledge.member?.id !== memberId)
      throw new ForbiddenException(
        'You can only log payments toward your own pledges.',
      );
    if (pledge.status !== PledgeStatus.ACTIVE)
      throw new BadRequestException(
        `Cannot log a payment against a ${pledge.status.toLowerCase()} pledge.`,
      );

    const contribution = this.contributionRepo.create({
      pledge,
      submittedBy: { id: memberId } as any,
      amount: dto.amount,
      paymentDate: dto.paymentDate,
      reference: dto.reference ?? null,
    });
    const saved = await this.contributionRepo.save(contribution);
    this.auditLogService.log('PLEDGE_CONTRIBUTION_SUBMITTED', {
      actorId: memberId,
      targetId: saved.id,
      metadata: { pledgeId, amount: dto.amount },
    });
    return saved;
  }

  // Called by GivingCheckoutService.handleWebhook when a member designates
  // an online payment toward a pledge — unlike submitContribution (member
  // self-reports, admin must confirm), the webhook has already verified the
  // money actually cleared, so this records it as CONFIRMED directly with
  // no review step. Callable as a normal injected service from inside
  // runInTenantContext: regular @InjectRepository-backed repos transparently
  // participate in the ambient CLS-scoped transaction it opens (see
  // tithe.processor.ts's doHandleBatch for the same pattern), so no manual
  // entity-manager threading is needed here.
  async recordConfirmedContribution(
    memberId: string,
    pledgeId: string,
    amount: number,
    reference: string,
  ): Promise<PledgeContribution> {
    const pledge = await this.pledgeRepo.findOne({ where: { id: pledgeId } });
    if (!pledge) throw new NotFoundException('Pledge not found.');

    const contribution = this.contributionRepo.create({
      pledge,
      submittedBy: { id: memberId } as any,
      amount,
      paymentDate: new Date().toISOString().slice(0, 10),
      reference,
      status: PledgeContributionStatus.CONFIRMED,
    });
    const saved = await this.contributionRepo.save(contribution);

    await this.maybeAutoCompletePledge(pledge.id);

    this.auditLogService.log('PLEDGE_CONTRIBUTION_CONFIRMED', {
      actorId: memberId,
      targetId: saved.id,
      metadata: { pledgeId, amount, source: 'giving-checkout' },
    });

    return saved;
  }

  async getMyContributions(
    memberId: string,
    pledgeId: string,
  ): Promise<PledgeContribution[]> {
    const pledge = await this.pledgeRepo.findOne({
      where: { id: pledgeId, member: { id: memberId } },
    });
    if (!pledge) throw new NotFoundException('Pledge not found.');
    return this.contributionRepo.find({
      where: { pledge: { id: pledgeId } },
      order: { createdAt: 'DESC' },
    });
  }

  async findContributions(
    query: PledgeContributionQueryDto,
  ): Promise<PaginationResponseDto<PledgeContribution>> {
    const { page = 1, limit = 20, status, pledgeId, campaignId } = query;
    const qb = this.contributionRepo
      .createQueryBuilder('pc')
      .leftJoinAndSelect('pc.pledge', 'pledge')
      .leftJoinAndSelect('pledge.campaign', 'campaign')
      .leftJoinAndSelect('pledge.member', 'member')
      .leftJoinAndSelect('pc.submittedBy', 'submittedBy')
      .leftJoinAndSelect('pc.reviewedBy', 'reviewedBy')
      .orderBy('pc.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (status) qb.andWhere('pc.status = :status', { status });
    if (pledgeId) qb.andWhere('pledge.id = :pledgeId', { pledgeId });
    if (campaignId) qb.andWhere('campaign.id = :campaignId', { campaignId });

    const [data, totalCount] = await qb.getManyAndCount();
    return {
      data,
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async confirmContribution(
    id: string,
    admin: Admin,
  ): Promise<PledgeContribution> {
    const contribution = await this.contributionRepo.findOne({
      where: { id, status: PledgeContributionStatus.PENDING },
      relations: ['pledge', 'pledge.member', 'pledge.campaign'],
    });
    if (!contribution)
      throw new NotFoundException('Pending contribution not found');

    contribution.status = PledgeContributionStatus.CONFIRMED;
    contribution.reviewedBy = admin;
    contribution.reviewedAt = new Date();
    const saved = await this.contributionRepo.save(contribution);

    await this.maybeAutoCompletePledge(contribution.pledge.id);

    this.auditLogService.log('PLEDGE_CONTRIBUTION_CONFIRMED', {
      actorId: admin.id,
      targetId: id,
      metadata: { pledgeId: contribution.pledge.id },
    });

    this.utilityService.sendEmailWithTemplate(
      contribution.pledge.member.email,
      'Your Pledge Payment Has Been Confirmed',
      'pledge-contribution-confirmed',
      {
        name: UtilityService.capitalizeFirstLetter(
          contribution.pledge.member.firstname,
        ),
        campaignName: contribution.pledge.campaign?.name ?? 'your pledge',
        amount: Number(contribution.amount).toLocaleString(),
        paymentDate: contribution.paymentDate,
      },
      undefined,
      EmailCategory.GIVING_RECEIPT,
    );

    return saved;
  }

  async declineContribution(
    id: string,
    dto: DeclinePledgeContributionDto,
    admin: Admin,
  ): Promise<PledgeContribution> {
    const contribution = await this.contributionRepo.findOne({
      where: { id, status: PledgeContributionStatus.PENDING },
      relations: ['pledge', 'pledge.member', 'pledge.campaign'],
    });
    if (!contribution)
      throw new NotFoundException('Pending contribution not found');

    contribution.status = PledgeContributionStatus.DECLINED;
    contribution.reviewedBy = admin;
    contribution.reviewedAt = new Date();
    contribution.financeNote = dto.financeNote;
    const saved = await this.contributionRepo.save(contribution);

    this.auditLogService.log('PLEDGE_CONTRIBUTION_DECLINED', {
      actorId: admin.id,
      targetId: id,
      metadata: { pledgeId: contribution.pledge.id, note: dto.financeNote },
    });

    this.utilityService.sendEmailWithTemplate(
      contribution.pledge.member.email,
      'Update on Your Pledge Payment Submission',
      'pledge-contribution-declined',
      {
        name: UtilityService.capitalizeFirstLetter(
          contribution.pledge.member.firstname,
        ),
        campaignName: contribution.pledge.campaign?.name ?? 'your pledge',
        amount: Number(contribution.amount).toLocaleString(),
        paymentDate: contribution.paymentDate,
        financeNote: dto.financeNote,
      },
      undefined,
      EmailCategory.GIVING_RECEIPT,
    );

    return saved;
  }

  private async maybeAutoCompletePledge(pledgeId: string): Promise<void> {
    const pledge = await this.pledgeRepo.findOne({ where: { id: pledgeId } });
    if (pledge?.status !== PledgeStatus.ACTIVE) return;

    const { sum } = await this.contributionRepo
      .createQueryBuilder('pc')
      .select('COALESCE(SUM(pc.amount), 0)', 'sum')
      .where('pc.pledge_id = :pledgeId', { pledgeId })
      .andWhere("pc.status = 'CONFIRMED'")
      .getRawOne();

    if (Number(sum) >= Number(pledge.totalAmount)) {
      pledge.status = PledgeStatus.COMPLETED;
      await this.pledgeRepo.save(pledge);
      this.auditLogService.log('PLEDGE_AUTO_COMPLETED', {
        targetId: pledgeId,
        metadata: { confirmedTotal: Number(sum) },
      });
    }
  }
}
