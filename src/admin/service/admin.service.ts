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
import { AdminPermission } from '../enum/admin-permission.enum';
import { AdminAccessService } from './admin-access.service';
import { FormAdminAccess } from '../entity/form-admin-access.entity';
import { AdminRoleService } from './admin-role.service';
import { AdminTwoFactorService } from './admin-two-factor.service';
import { AdminOwnerService } from './admin-owner.service';
import { GrantAdminDto, UpdateAdminUserDto } from '../dto/admin-user.dto';
import { MemberService } from '../../member/service/member.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { UtilityService } from '../../utility/service/utility.service';
import { AppearanceMode } from '../../member/enums/appearance-mode.enum';

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
    private readonly twoFactor: AdminTwoFactorService,
    private readonly owners: AdminOwnerService,
    private readonly access: AdminAccessService,
    @InjectRepository(FormAdminAccess)
    private readonly formAccessRepository: Repository<FormAdminAccess>,
  ) {}

  async grant(dto: GrantAdminDto, actorId: string): Promise<Admin> {
    const role = await this.adminRoleService.getById(dto.adminRoleId);
    if (dto.additionalPermissions !== undefined)
      await this.access.assertEnabled();
    const member = await this.memberService.getById(dto.memberId);

    const existing = await this.adminRepository.findOne({
      where: { member: { id: member.id } },
    });
    if (await this.access.isOn()) {
      const actor = await this.findByMemberId(actorId);
      await this.access.assertCanDelegate(actor, [
        ...role.permissions,
        ...(dto.additionalPermissions ?? existing?.additionalPermissions ?? []),
      ]);
    }
    if (existing) {
      if (existing.isActive) {
        this.logger.warn(
          `Admin grant attempted for already-active member: ${member.id}`,
        );
        throw new ConflictException(
          'This member already has an active admin account.',
        );
      }
      await this.owners.assertCanChange(existing, actorId);
      existing.isActive = true;
      if (dto.additionalPermissions !== undefined)
        existing.additionalPermissions = dto.additionalPermissions;
      existing.adminRole = role;
      const saved = await this.adminRepository.save(existing);
      this.logger.log(`Admin access reactivated for member ${member.id}`);
      this.auditLogService.log('ADMIN_USER_CREATED', {
        actorId,
        targetId: member.id,
        targetEmail: member.email,
        targetName: `${member.firstname} ${member.lastname}`,
        metadata: {
          adminRoleId: dto.adminRoleId,
          reactivated: true,
          additionalPermissions: existing.additionalPermissions ?? [],
        },
      });
      this.sendAdminWelcomeEmail(member.email, member.firstname);
      return this.access.describe(saved);
    }

    const adminRole = role;
    const admin = this.adminRepository.create({
      member,
      adminRole,
      isActive: true,
      additionalPermissions: dto.additionalPermissions ?? [],
    });
    const saved = await this.adminRepository.save(admin);
    this.logger.log(`Admin access granted to member ${member.id}`);
    this.auditLogService.log('ADMIN_USER_CREATED', {
      actorId,
      targetId: member.id,
      targetEmail: member.email,
      targetName: `${member.firstname} ${member.lastname}`,
      metadata: {
        adminRoleId: dto.adminRoleId,
        additionalPermissions: dto.additionalPermissions ?? [],
      },
    });
    this.sendAdminWelcomeEmail(member.email, member.firstname);
    return this.access.describe(saved);
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

    await this.owners.assertCanChange(admin, actorId);
    if (dto.isActive === false) await this.owners.assertNotLastOwner(admin);

    const previousAdditionalPermissions = [
      ...(admin.additionalPermissions ?? []),
    ];
    if (dto.additionalPermissions !== undefined)
      await this.access.assertEnabled();
    const role = dto.adminRoleId
      ? await this.adminRoleService.getById(dto.adminRoleId)
      : admin.adminRole;
    if (await this.access.isOn()) {
      const actor = await this.findByMemberId(actorId);
      await this.access.assertCanDelegate(actor, [
        ...role.permissions,
        ...(dto.additionalPermissions ?? admin.additionalPermissions ?? []),
      ]);
    }
    if (dto.additionalPermissions !== undefined)
      admin.additionalPermissions = dto.additionalPermissions;
    const previousRoleName = admin.adminRole?.name;

    if (dto.adminRoleId) {
      admin.adminRole = role;
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
        ...(dto.additionalPermissions !== undefined && {
          additionalPermissionsFrom: previousAdditionalPermissions,
          additionalPermissionsTo: dto.additionalPermissions,
        }),
        ...(dto.adminRoleId && {
          roleFrom: previousRoleName,
          roleTo: admin.adminRole?.name,
        }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
    return this.access.describe(saved);
  }

  async resetTwoFactor(id: string, actorId: string): Promise<void> {
    const admin = await this.findById(id);
    if (admin.member?.id === actorId) {
      throw new ForbiddenException(
        'Ask another admin to reset your two-factor sign-in.',
      );
    }
    await this.owners.assertCanChange(admin, actorId);
    await this.twoFactor.resetByAnotherAdmin(admin.member.id, actorId);
  }

  async revoke(id: string, actorId: string): Promise<void> {
    const admin = await this.findById(id);
    await this.owners.assertCanChange(admin, actorId);
    await this.owners.assertNotLastOwner(admin);
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
    return Promise.all(admins.map((admin) => this.access.describe(admin)));
  }

  async updateMyAppearanceMode(
    id: string,
    appearanceMode?: AppearanceMode,
    useChurchTheme?: boolean,
  ): Promise<{ appearanceMode: AppearanceMode; useChurchTheme: boolean }> {
    const admin = await this.findById(id);
    const member = await this.memberService.updateAppearanceMode(
      admin.member.id,
      appearanceMode,
      useChurchTheme,
    );
    return {
      appearanceMode: member.appearanceMode,
      useChurchTheme: member.useChurchTheme,
    };
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
    return this.access.describe(admin);
  }

  // Separate from findById — AdminGuard already preloads 'member' on every
  // guarded request, so adding 'member.spouse' there would join on every
  // admin API call just for a field only the "my profile" page needs. This
  // one-off refetch keeps that cost isolated to GET /admin/users/me.
  async getMyProfile(id: string): Promise<Admin> {
    const admin = await this.adminRepository.findOne({
      where: { id },
      relations: ['member', 'member.spouse', 'adminRole'],
    });
    if (!admin) throw new NotFoundException('Admin user not found.');
    if (admin.member) {
      delete (admin.member as any).password;
      delete (admin.member as any).deviceId;
    }
    await this.access.describe(admin);
    admin.hasAssignedForms =
      admin.accessGrantsEnabled &&
      (await this.formAccessRepository.existsBy({
        adminId: id,
        canView: true,
      }));
    return admin;
  }

  async updateFavouritePages(
    id: string,
    pages: string[],
  ): Promise<{ favouritePages: string[] }> {
    const favouritePages = [...new Set(pages)];
    await this.adminRepository.update(id, { favouritePages });
    return { favouritePages };
  }

  async assertCanRecoverFormAccess(actor: Admin, target: Admin): Promise<void> {
    if (
      !(await this.access.isOn()) ||
      (await this.access.has(actor, AdminPermission.FORMS_READ))
    )
      return;
    if (
      await this.formAccessRepository.existsBy({
        adminId: target.id,
        canView: true,
      })
    ) {
      throw new ForbiddenException(
        'Recovering an admin with assigned forms requires access to all forms.',
      );
    }
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
