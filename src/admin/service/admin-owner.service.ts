import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { Repository } from 'typeorm';
import { Admin } from '../entity/admin.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { OrganisationTypeEnum } from '../../tenant/enum/organisation-type.enum';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { UtilityService } from '../../utility/service/utility.service';

export interface OwnerSummary {
  id: string;
  name: string;
  email: string;
  invitedAt?: Date | null;
}

export interface OwnersView {
  owners: OwnerSummary[];
  pendingInvites: OwnerSummary[];
  secondOwnerRequired: boolean;
}

function summarise(admin: Admin): OwnerSummary {
  return {
    id: admin.id,
    name: `${admin.member.firstname} ${admin.member.lastname}`.trim(),
    email: admin.member.email,
    invitedAt: admin.ownerInvitedAt,
  };
}

// Owners hold the account for the church: at least one always, and churches are asked to keep two.
@Injectable()
export class AdminOwnerService {
  constructor(
    @InjectRepository(Admin)
    private readonly adminRepository: Repository<Admin>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly cls: ClsService<AppClsStore>,
    private readonly auditLogService: AuditLogService,
    private readonly utilityService: UtilityService,
  ) {}

  async list(): Promise<OwnersView> {
    const rows = await this.adminRepository
      .createQueryBuilder('admin')
      .innerJoinAndSelect('admin.member', 'member')
      .where('admin.isActive = true')
      .andWhere('(admin.isOwner = true OR admin.ownerInvitedAt IS NOT NULL)')
      .getMany();
    const tenant = await this.tenantRepo.findOne({
      select: { id: true, orgType: true },
      where: { id: this.cls.get('tenantId') },
    });
    return {
      owners: rows.filter((a) => a.isOwner).map(summarise),
      pendingInvites: rows.filter((a) => !a.isOwner).map(summarise),
      secondOwnerRequired: tenant?.orgType !== OrganisationTypeEnum.GROUP,
    };
  }

  async invite(actor: Admin, targetId: string): Promise<void> {
    const target = await this.activeAdmin(targetId);
    if (target.isOwner) {
      throw new BadRequestException('This admin is already an owner.');
    }
    target.ownerInvitedAt = new Date();
    target.ownerInvitedBy = actor;
    await this.adminRepository.save(target);
    this.auditLogService.log('ADMIN_OWNER_INVITED', {
      actorId: actor.member?.id,
      targetId: target.member.id,
    });
    this.notify(
      target,
      'You have been asked to be an account owner',
      `${actor.member?.firstname ?? 'An owner'} has asked you to become an account owner. Owners control billing, admins and the account itself. Sign in to the admin portal and open Admin Management to accept or decline.`,
    );
  }

  async accept(admin: Admin): Promise<void> {
    if (!admin.ownerInvitedAt) {
      throw new BadRequestException('You have no ownership invite.');
    }
    await this.adminRepository.update(admin.id, {
      isOwner: true,
      ownerInvitedAt: null,
      ownerInvitedBy: null,
    });
    this.auditLogService.log('ADMIN_OWNER_ACCEPTED', {
      actorId: admin.member?.id,
    });
    await this.notifyOwners(
      'A new account owner was added',
      `${admin.member?.firstname} ${admin.member?.lastname} is now an account owner.`,
    );
  }

  async decline(admin: Admin): Promise<void> {
    if (!admin.ownerInvitedAt) {
      throw new BadRequestException('You have no ownership invite.');
    }
    await this.clearInvite(admin.id);
    this.auditLogService.log('ADMIN_OWNER_DECLINED', {
      actorId: admin.member?.id,
    });
  }

  async cancelInvite(actor: Admin, targetId: string): Promise<void> {
    const target = await this.activeAdmin(targetId);
    await this.clearInvite(target.id);
    this.auditLogService.log('ADMIN_OWNER_INVITE_CANCELLED', {
      actorId: actor.member?.id,
      targetId: target.member.id,
    });
  }

  // The conditional update stops the last two owners both stepping down at once.
  async stepDown(admin: Admin): Promise<void> {
    const result = await this.adminRepository
      .createQueryBuilder()
      .update(Admin)
      .set({ isOwner: false })
      .where(
        `id = :id AND is_owner = true AND EXISTS (
           SELECT 1 FROM admins other
           WHERE other.is_owner = true AND other.is_active = true AND other.id != :id
         )`,
        { id: admin.id },
      )
      .execute();
    if (!result.affected) {
      throw new ConflictException(
        'A church must always have an owner. Add another owner first.',
      );
    }
    this.auditLogService.log('ADMIN_OWNER_STEPPED_DOWN', {
      actorId: admin.member?.id,
    });
    await this.notifyOwners(
      'An account owner stepped down',
      `${admin.member?.firstname} ${admin.member?.lastname} is no longer an account owner.`,
    );
  }

  // Protects owners from non-owner admins, and the last owner from everyone.
  async assertCanChange(target: Admin, actorMemberId: string): Promise<void> {
    if (!target.isOwner) return;
    const actor = await this.adminRepository.findOne({
      where: { member: { id: actorMemberId }, isActive: true },
    });
    if (!actor?.isOwner) {
      throw new ForbiddenException(
        'Only an account owner can change an owner.',
      );
    }
  }

  async assertNotLastOwner(target: Admin): Promise<void> {
    if (!target.isOwner) return;
    const others = await this.adminRepository
      .createQueryBuilder('admin')
      .where('admin.isOwner = true AND admin.isActive = true')
      .andWhere('admin.id != :id', { id: target.id })
      .getCount();
    if (!others) {
      throw new ConflictException(
        'A church must always have an owner. Add another owner first.',
      );
    }
  }

  private async activeAdmin(id: string): Promise<Admin> {
    const admin = await this.adminRepository.findOne({
      where: { id, isActive: true },
      relations: ['member'],
    });
    if (!admin) throw new NotFoundException('Admin user not found.');
    return admin;
  }

  private async clearInvite(id: string): Promise<void> {
    await this.adminRepository.update(id, {
      ownerInvitedAt: null,
      ownerInvitedBy: null,
    });
  }

  private async notifyOwners(heading: string, message: string): Promise<void> {
    const owners = await this.adminRepository.find({
      where: { isOwner: true, isActive: true },
      relations: ['member'],
    });
    owners.forEach((owner) => this.notify(owner, heading, message));
  }

  private notify(admin: Admin, heading: string, message: string): void {
    this.utilityService.sendEmailWithTemplate(
      admin.member.email,
      heading,
      'admin-security-notice',
      { name: admin.member.firstname ?? 'Admin', heading, message },
    );
  }
}
