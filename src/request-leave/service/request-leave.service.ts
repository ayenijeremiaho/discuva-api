import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RequestLeave } from '../enitity/request-leave.entity';
import { CreateRequestLeaveDto } from '../dto/create-request-leave.dto';
import { LeaveStatusEnum } from '../enums/leave-status.enum';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { MemberService } from '../../member/service/member.service';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { DepartmentService } from '../../department/service/department.service';

@Injectable()
export class RequestLeaveService {
  constructor(
    @InjectRepository(RequestLeave)
    private readonly repo: Repository<RequestLeave>,
    private readonly memberService: MemberService,
    private readonly departmentService: DepartmentService,
    private readonly utilityService: UtilityService,
    private readonly auditLogService: AuditLogService,
  ) {}

  private readonly logger = new Logger(RequestLeaveService.name);

  async requestLeave(
    user: MemberAuth,
    dto: CreateRequestLeaveDto,
  ): Promise<RequestLeave> {
    const member = await this.memberService.getById(user.id, ['workerProfile']);

    if (!member.workerProfile) {
      throw new BadRequestException('Only workers can submit leave requests.');
    }

    const hasPending = await this.repo.exists({
      where: {
        workerProfile: { id: member.workerProfile.id },
        status: LeaveStatusEnum.PENDING,
      },
    });

    if (hasPending) {
      throw new BadRequestException('You already have a pending leave request');
    }

    const fromDateStr = String(dto.dateFrom).substring(0, 10);
    const toDateStr = String(dto.dateTo).substring(0, 10);

    if (toDateStr < fromDateStr) {
      throw new BadRequestException('dateTo must be on or after dateFrom');
    }

    const hasApprovedOverlap =
      (await this.repo
        .createQueryBuilder('rl')
        .innerJoin('rl.workerProfile', 'wp')
        .where('wp.id = :profileId', { profileId: member.workerProfile.id })
        .andWhere('rl.status = :status', { status: LeaveStatusEnum.APPROVED })
        .andWhere('rl.dateFrom <= :toDate', { toDate: toDateStr })
        .andWhere('rl.dateTo >= :fromDate', { fromDate: fromDateStr })
        .getCount()) > 0;

    if (hasApprovedOverlap) {
      throw new BadRequestException(
        'You already have approved leave covering those dates',
      );
    }

    const saved = await this.repo.save(
      this.repo.create({
        workerProfile: member.workerProfile,
        dateFrom: new Date(dto.dateFrom),
        dateTo: new Date(dto.dateTo),
        reason: dto.reason,
        status: LeaveStatusEnum.PENDING,
      }),
    );
    this.logger.log(
      `Leave request ${saved.id} submitted by member ${user.id} (${dto.dateFrom} → ${dto.dateTo})`,
    );

    const firstName = UtilityService.capitalizeFirstLetter(member.firstname);
    const churchName = await this.utilityService.resolveChurchName();
    this.utilityService.sendEmailWithTemplate(
      member.email,
      `${firstName}, ${churchName} Leave Request Received`,
      'leave-submitted',
      {
        name: firstName,
        dateFrom: new Date(dto.dateFrom).toLocaleDateString('en-GB', {
          dateStyle: 'medium',
        }),
        dateTo: new Date(dto.dateTo).toLocaleDateString('en-GB', {
          dateStyle: 'medium',
        }),
        reason: dto.reason,
      },
    );

    return saved;
  }

  async actionLeave(
    user: MemberAuth,
    leaveId: string,
    status: LeaveStatusEnum,
  ): Promise<RequestLeave> {
    const leave = await this.repo.findOne({
      where: { id: leaveId },
      relations: ['workerProfile', 'workerProfile.member'],
    });

    if (!leave) throw new NotFoundException('Leave request not found');
    if (leave.status !== LeaveStatusEnum.PENDING) {
      throw new BadRequestException('Only pending requests can be actioned');
    }
    if (
      ![LeaveStatusEnum.APPROVED, LeaveStatusEnum.REJECTED].includes(status)
    ) {
      throw new BadRequestException('Status must be APPROVED or REJECTED');
    }

    const admin = await this.memberService.getById(user.id);
    leave.status = status;
    leave.actionedBy = admin;

    const saved = await this.repo.save(leave);
    this.auditLogService.log(
      status === LeaveStatusEnum.APPROVED ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
      {
        actorId: user.id,
        targetId: leaveId,
        metadata: { workerMemberId: leave.workerProfile?.member?.id },
      },
    );

    const workerMember = leave.workerProfile?.member;
    if (workerMember?.email) {
      const firstName = UtilityService.capitalizeFirstLetter(
        workerMember.firstname,
      );
      const actionStatus =
        status === LeaveStatusEnum.APPROVED ? 'Approved' : 'Rejected';
      const churchName = await this.utilityService.resolveChurchName();
      this.utilityService.sendEmailWithTemplate(
        workerMember.email,
        `${firstName}, ${churchName} Leave Request ${actionStatus}`,
        'leave-actioned',
        {
          name: firstName,
          actionStatus,
          dateFrom: new Date(leave.dateFrom).toLocaleDateString('en-GB', {
            dateStyle: 'medium',
          }),
          dateTo: new Date(leave.dateTo).toLocaleDateString('en-GB', {
            dateStyle: 'medium',
          }),
        },
      );
    }

    return saved;
  }

  async deleteLeaveRequest(user: MemberAuth, leaveId: string): Promise<void> {
    const member = await this.memberService.getById(user.id, ['workerProfile']);

    if (!member.workerProfile) {
      throw new BadRequestException(
        'Your worker profile could not be found. Please contact your admin.',
      );
    }

    const leave = await this.repo.findOneBy({
      id: leaveId,
      workerProfile: { id: member.workerProfile.id },
    });

    if (!leave) throw new NotFoundException('Leave request not found');
    if (leave.status !== LeaveStatusEnum.PENDING) {
      throw new BadRequestException('Only pending requests can be deleted');
    }

    await this.repo.delete(leaveId);
    this.logger.log(`Leave request ${leaveId} withdrawn by member ${user.id}`);
  }

  async getMyLeaveHistory(
    user: MemberAuth,
    page = 1,
    limit = 10,
    status?: LeaveStatusEnum,
  ): Promise<PaginationResponseDto<RequestLeave>> {
    if (page < 1) throw new BadRequestException('Page must be greater than 0');
    const member = await this.memberService.getById(user.id, ['workerProfile']);
    if (!member.workerProfile)
      return UtilityService.createPaginationResponse([], page, limit, 0);

    const [leaves, total] = await this.repo.findAndCount({
      where: {
        workerProfile: { id: member.workerProfile.id },
        ...(status ? { status } : {}),
      },
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });

    return UtilityService.createPaginationResponse(leaves, page, limit, total);
  }

  async getAllLeaveHistory(
    page = 1,
    limit = 10,
    status?: LeaveStatusEnum,
  ): Promise<PaginationResponseDto<RequestLeave>> {
    if (page < 1) throw new BadRequestException('Page must be greater than 0');

    const [leaves, total] = await this.repo.findAndCount({
      where: status ? { status } : {},
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
      relations: ['workerProfile', 'workerProfile.member', 'actionedBy'],
    });

    return UtilityService.createPaginationResponse(leaves, page, limit, total);
  }

  async getDepartmentLeaveRequests(
    user: MemberAuth,
    page = 1,
    limit = 10,
    status?: LeaveStatusEnum,
  ): Promise<PaginationResponseDto<RequestLeave>> {
    if (page < 1) throw new BadRequestException('Page must be greater than 0');
    const isLead = await this.departmentService.isMemberDepartmentLead(user.id);
    if (!isLead)
      throw new BadRequestException(
        'You are not authorized to view leave requests for this department.',
      );

    const member = await this.memberService.getById(user.id, [
      'workerProfile',
      'workerProfile.department',
    ]);
    const deptId = member.workerProfile?.department?.id;
    if (!deptId)
      throw new BadRequestException(
        'You do not have a department assigned. Please contact your admin.',
      );

    const [leaves, total] = await this.repo.findAndCount({
      where: {
        workerProfile: { department: { id: deptId } },
        ...(status ? { status } : {}),
      },
      relations: ['workerProfile', 'workerProfile.member', 'actionedBy'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return UtilityService.createPaginationResponse(leaves, page, limit, total);
  }

  async countPendingLeave(
    workerProfileId?: string,
    departmentId?: string,
  ): Promise<number> {
    const where: any = { status: LeaveStatusEnum.PENDING };

    if (workerProfileId) {
      where.workerProfile = { id: workerProfileId };
    } else if (departmentId) {
      where.workerProfile = { department: { id: departmentId } };
    }

    return this.repo.count({ where });
  }
}
