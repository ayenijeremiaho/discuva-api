import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { Convert } from '../entity/convert.entity';
import { ConvertFollowUpLog } from '../entity/convert-follow-up-log.entity';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { Member } from '../../member/entity/member.entity';
import {
  CreateConvertDto,
  LogFollowUpDto,
  UpdateConvertStatusDto,
  ReassignConvertDto,
  LinkConvertToMemberDto,
} from '../dto/convert.dto';
import { ConvertStatusEnum } from '../enum/convert-status.enum';
import { DepartmentCapability } from '../../department/enums/department-capability.enum';
import { DepartmentAccessService } from '../../department/service/department-access.service';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { MemberService } from '../../member/service/member.service';
import { MemberAuth } from '../../auth/interface/auth.interface';

const OVERDUE_DAYS = 7;

export interface ConvertWithStaleness extends Convert {
  daysSinceLastContact: number | null;
  isOverdue: boolean;
}

@Injectable()
export class ConvertService {
  constructor(
    @InjectRepository(Convert)
    private readonly convertRepo: Repository<Convert>,
    @InjectRepository(ConvertFollowUpLog)
    private readonly followUpLogRepo: Repository<ConvertFollowUpLog>,
    @InjectRepository(WorkerProfile)
    private readonly workerProfileRepo: Repository<WorkerProfile>,
    private readonly memberService: MemberService,
    private readonly auditLogService: AuditLogService,
    private readonly departmentAccessService: DepartmentAccessService,
  ) {}

  async createConvert(
    dto: CreateConvertDto,
    currentUser: MemberAuth,
  ): Promise<Convert> {
    const onboarder = await this.memberService.getById(currentUser.id);

    const convert = this.convertRepo.create({
      name: dto.name,
      phone: dto.phone ?? null,
      notes: dto.notes ?? null,
      status: dto.status ?? ConvertStatusEnum.UNSAVED,
      onboardedBy: { id: onboarder.id } as Member,
      onboardedByName: `${onboarder.firstname} ${onboarder.lastname}`,
    });
    const saved = await this.convertRepo.save(convert);

    this.auditLogService.log('CONVERT_CREATED', {
      actorId: currentUser.id,
      targetId: saved.id,
    });

    return saved;
  }

  async logFollowUp(
    convertId: string,
    dto: LogFollowUpDto,
    currentUser: MemberAuth,
  ): Promise<ConvertFollowUpLog> {
    const convert = await this.convertRepo.findOne({
      where: { id: convertId },
    });
    if (!convert) throw new NotFoundException('Convert not found');

    const logger = await this.memberService.getById(currentUser.id);

    const log = this.followUpLogRepo.create({
      convert,
      loggedBy: { id: logger.id } as Member,
      loggedByName: `${logger.firstname} ${logger.lastname}`,
      note: dto.note ?? null,
    });
    const saved = await this.followUpLogRepo.save(log);

    convert.lastContactedAt = saved.contactedAt;
    await this.convertRepo.save(convert);

    this.auditLogService.log('CONVERT_FOLLOW_UP_LOGGED', {
      actorId: currentUser.id,
      targetId: saved.id,
      metadata: { convertId },
    });

    return saved;
  }

  async getFollowUpHistory(
    convertId: string,
    page = 1,
    limit = 10,
  ): Promise<PaginationResponseDto<ConvertFollowUpLog>> {
    const convertExists = await this.convertRepo.existsBy({ id: convertId });
    if (!convertExists) throw new NotFoundException('Convert not found');

    const [data, total] = await this.followUpLogRepo.findAndCount({
      where: { convert: { id: convertId } },
      order: { contactedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async getTeamConverts(
    page = 1,
    limit = 10,
    status?: ConvertStatusEnum,
  ): Promise<PaginationResponseDto<ConvertWithStaleness>> {
    const where: FindOptionsWhere<Convert> = {};
    if (status) where.status = status;

    const [data, total] = await this.convertRepo.findAndCount({
      where,
      relations: ['assignedTo', 'assignedTo.member', 'member'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const now = Date.now();
    const withStaleness: ConvertWithStaleness[] = data.map((c) => {
      const daysSinceLastContact = c.lastContactedAt
        ? Math.floor(
            (now - c.lastContactedAt.getTime()) / (1000 * 60 * 60 * 24),
          )
        : null;
      const isOverdue =
        !c.member &&
        (daysSinceLastContact === null || daysSinceLastContact > OVERDUE_DAYS);
      return { ...c, daysSinceLastContact, isOverdue };
    });

    return UtilityService.createPaginationResponse(
      withStaleness,
      page,
      limit,
      total,
    );
  }

  async getAllConvertsForAdmin(
    page = 1,
    limit = 10,
    status?: ConvertStatusEnum,
  ): Promise<PaginationResponseDto<Convert>> {
    const where: FindOptionsWhere<Convert> = {};
    if (status) where.status = status;

    const [data, total] = await this.convertRepo.findAndCount({
      where,
      relations: ['assignedTo', 'assignedTo.member', 'onboardedBy'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return UtilityService.createPaginationResponse(data, page, limit, total);
  }

  async updateStatus(
    convertId: string,
    dto: UpdateConvertStatusDto,
    actorId: string,
  ): Promise<Convert> {
    const convert = await this.convertRepo.findOne({
      where: { id: convertId },
    });
    if (!convert) throw new NotFoundException('Convert not found');

    convert.status = dto.status;
    const saved = await this.convertRepo.save(convert);

    this.auditLogService.log('CONVERT_STATUS_UPDATED', {
      actorId,
      targetId: saved.id,
      metadata: { status: dto.status },
    });

    return saved;
  }

  async reassignConvert(
    convertId: string,
    dto: ReassignConvertDto,
    actorAdminId: string,
  ): Promise<Convert> {
    const [convert, targetProfile] = await Promise.all([
      this.convertRepo.findOne({ where: { id: convertId } }),
      this.workerProfileRepo.findOne({
        where: { id: dto.workerProfileId },
        relations: ['department', 'secondaryDepartment'],
      }),
    ]);
    if (!convert) throw new NotFoundException('Convert not found');
    if (!targetProfile) throw new NotFoundException('Worker profile not found');

    const isEvangelismWorker =
      !!targetProfile.department?.capabilities?.includes(
        DepartmentCapability.MANAGE_EVANGELISM_CONVERTS,
      ) ||
      !!targetProfile.secondaryDepartment?.capabilities?.includes(
        DepartmentCapability.MANAGE_EVANGELISM_CONVERTS,
      );
    if (!isEvangelismWorker) {
      throw new BadRequestException(
        'Target worker must be in the Evangelism department',
      );
    }

    convert.assignedTo = targetProfile;
    const saved = await this.convertRepo.save(convert);

    this.auditLogService.log('CONVERT_REASSIGNED', {
      actorId: actorAdminId,
      targetId: saved.id,
      metadata: { workerProfileId: dto.workerProfileId },
    });

    return saved;
  }

  async linkToMember(
    convertId: string,
    dto: LinkConvertToMemberDto,
    actorAdminId: string,
  ): Promise<Convert> {
    const convert = await this.convertRepo.findOne({
      where: { id: convertId },
    });
    if (!convert) throw new NotFoundException('Convert not found');

    convert.member = { id: dto.memberId } as Member;
    convert.linkedAt = new Date();
    const saved = await this.convertRepo.save(convert);

    this.auditLogService.log('CONVERT_LINKED_TO_MEMBER', {
      actorId: actorAdminId,
      targetId: saved.id,
      metadata: { memberId: dto.memberId },
    });

    return saved;
  }

  async assertIsEvangelismDeptWorker(memberId: string): Promise<void> {
    await this.departmentAccessService.assertHasCapability(
      memberId,
      DepartmentCapability.MANAGE_EVANGELISM_CONVERTS,
      'Only Evangelism Convert Management workers can perform this action',
    );
  }
}
