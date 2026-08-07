import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Admin } from '../entity/admin.entity';
import { AdminRoleService } from './admin-role.service';
import { GrantAdminDto, UpdateAdminUserDto } from '../dto/admin-user.dto';
import { MemberService } from '../../member/service/member.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { UtilityService } from '../../utility/service/utility.service';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectRepository(Admin)
    private readonly adminRepository: Repository<Admin>,
    private readonly adminRoleService: AdminRoleService,
    private readonly memberService: MemberService,
    private readonly auditLogService: AuditLogService,
    private readonly utilityService: UtilityService,
  ) {}

  async grant(dto: GrantAdminDto, actorId: string): Promise<Admin> {
    const member = await this.memberService.getById(dto.memberId);

    const existing = await this.adminRepository.findOne({
      where: { member: { id: member.id } },
    });
    if (existing) {
      if (existing.isActive) {
        this.logger.warn(
          `Admin grant attempted for already-active member: ${member.id}`,
        );
        throw new ConflictException(
          'This member already has an active admin account.',
        );
      }
      existing.isActive = true;
      const role = await this.adminRoleService.getById(dto.adminRoleId);
      existing.adminRole = role;
      const saved = await this.adminRepository.save(existing);
      this.logger.log(`Admin access reactivated for member ${member.id}`);
      this.auditLogService.log('ADMIN_USER_CREATED', {
        actorId,
        targetId: member.id,
        targetEmail: member.email,
        targetName: `${member.firstname} ${member.lastname}`,
        metadata: { adminRoleId: dto.adminRoleId, reactivated: true },
      });
      this.sendAdminWelcomeEmail(member.email, member.firstname);
      return saved;
    }

    const adminRole = await this.adminRoleService.getById(dto.adminRoleId);
    const admin = this.adminRepository.create({
      member,
      adminRole,
      isActive: true,
    });
    const saved = await this.adminRepository.save(admin);
    this.logger.log(`Admin access granted to member ${member.id}`);
    this.auditLogService.log('ADMIN_USER_CREATED', {
      actorId,
      targetId: member.id,
      targetEmail: member.email,
      targetName: `${member.firstname} ${member.lastname}`,
      metadata: { adminRoleId: dto.adminRoleId },
    });
    this.sendAdminWelcomeEmail(member.email, member.firstname);
    return saved;
  }

  async update(
    id: string,
    dto: UpdateAdminUserDto,
    actorId: string,
  ): Promise<Admin> {
    const admin = await this.findById(id);

    if (admin.member?.id === actorId) {
      throw new ForbiddenException('You cannot modify your own admin record.');
    }

    const previousRoleName = admin.adminRole?.name;

    if (dto.adminRoleId) {
      admin.adminRole = await this.adminRoleService.getById(dto.adminRoleId);
    }
    if (dto.isActive !== undefined) admin.isActive = dto.isActive;

    const saved = await this.adminRepository.save(admin);
    this.logger.log(`Admin record ${id} updated by actor ${actorId}`);
    this.auditLogService.log('ADMIN_USER_UPDATED', {
      actorId,
      targetId: admin.member?.id,
      targetEmail: admin.member?.email,
      targetName: admin.member
        ? `${admin.member.firstname} ${admin.member.lastname}`
        : undefined,
      metadata: {
        changes: Object.keys(dto),
        ...(dto.adminRoleId && {
          roleFrom: previousRoleName,
          roleTo: admin.adminRole?.name,
        }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
    return saved;
  }

  async revoke(id: string, actorId: string): Promise<void> {
    const admin = await this.findById(id);
    admin.isActive = false;
    await this.adminRepository.save(admin);
    this.logger.log(
      `Admin access revoked for admin record ${id} by actor ${actorId}`,
    );
    this.auditLogService.log('ADMIN_USER_DEACTIVATED', {
      actorId,
      targetId: admin.member?.id,
      targetEmail: admin.member?.email,
      targetName: admin.member
        ? `${admin.member.firstname} ${admin.member.lastname}`
        : undefined,
    });
    if (admin.member?.email) {
      this.utilityService.sendEmailWithTemplate(
        admin.member.email,
        'Your Admin Access Has Been Revoked',
        'account-deactivated',
        {
          name: UtilityService.capitalizeFirstLetter(
            admin.member.firstname ?? 'Admin',
          ),
        },
      );
    }
  }

  async getAll(): Promise<Admin[]> {
    const admins = await this.adminRepository.find({
      relations: ['member', 'adminRole'],
      order: { createdAt: 'DESC' },
    });
    for (const a of admins) {
      if (a.member) {
        delete (a.member as any).password;
        delete (a.member as any).deviceId;
      }
    }
    return admins;
  }

  async findById(id: string): Promise<Admin> {
    const admin = await this.adminRepository.findOne({
      where: { id },
      relations: ['member', 'adminRole'],
    });
    if (!admin) throw new NotFoundException('Admin user not found.');
    if (admin.member) {
      delete (admin.member as any).password;
      delete (admin.member as any).deviceId;
    }
    return admin;
  }

  async countActive(): Promise<number> {
    return this.adminRepository.countBy({ isActive: true });
  }

  async findByMemberId(memberId: string): Promise<Admin | null> {
    return this.adminRepository.findOne({
      where: { member: { id: memberId }, isActive: true },
      relations: ['adminRole'],
    });
  }

  private sendAdminWelcomeEmail(email: string, firstname: string): void {
    const name = UtilityService.capitalizeFirstLetter(firstname ?? 'Admin');
    this.utilityService.sendEmailWithTemplate(
      email,
      'Your Admin Account Has Been Created',
      'welcome-admin',
      {
        name,
        email,
        password: 'Your existing account password',
      },
    );
  }
}
