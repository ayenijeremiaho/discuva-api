import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PledgeStatus } from '../enum/finance.enum';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Pledge } from '../entity/pledge.entity';
import { PledgeCampaign } from '../entity/pledge-campaign.entity';
import {
  CreatePledgeCampaignDto,
  CreatePledgeDto,
  MakePledgeDto,
  PledgeQueryDto,
  UpdatePledgeStatusDto,
} from '../dto/pledge.dto';
import { Admin } from '../../admin/entity/admin.entity';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';

@Injectable()
export class PledgeService {
  constructor(
    @InjectRepository(Pledge)
    private readonly pledgeRepo: Repository<Pledge>,
    @InjectRepository(PledgeCampaign)
    private readonly campaignRepo: Repository<PledgeCampaign>,
    private readonly auditLogService: AuditLogService,
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
      .orderBy('c.start_date', 'DESC')
      .getRawAndEntities();

    return entities.map((entity, i) => {
      (entity as any).totalPledged = Number(raw[i]?.totalPledged ?? 0);
      (entity as any).pledgeCount = Number(raw[i]?.pledgeCount ?? 0);
      return entity;
    });
  }

  async findOneCampaign(id: string): Promise<PledgeCampaign> {
    const campaign = await this.campaignRepo.findOne({
      where: { id },
      relations: ['fund', 'createdBy'],
    });
    if (!campaign) throw new NotFoundException('Pledge campaign not found.');
    return campaign;
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
      .orderBy('p.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (campaignId) qb.andWhere('campaign.id = :campaignId', { campaignId });
    if (memberId) qb.andWhere('member.id = :memberId', { memberId });
    if (status) qb.andWhere('p.status = :status', { status });

    const [data, totalCount] = await qb.getManyAndCount();
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
    return this.pledgeRepo.find({
      where: { member: { id: memberId } },
      relations: ['campaign', 'campaign.fund'],
      order: { createdAt: 'DESC' },
    });
  }

  findActivePledgesForReminder(): Promise<Pledge[]> {
    return this.pledgeRepo.find({
      where: { status: PledgeStatus.ACTIVE },
      relations: ['member', 'campaign'],
    });
  }
}
