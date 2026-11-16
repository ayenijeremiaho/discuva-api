import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminPermission } from '../enum/admin-permission.enum';
import { AdminAccessService } from './admin-access.service';
import { Admin } from '../entity/admin.entity';
import { AdminRole } from '../entity/admin-role.entity';
import { CreateAdminRoleDto, UpdateAdminRoleDto } from '../dto/admin-role.dto';
import { AuditLogService } from '../../utility/service/audit-log.service';

@Injectable()
export class AdminRoleService {
  private readonly logger = new Logger(AdminRoleService.name);

  constructor(
    @InjectRepository(AdminRole)
    private readonly adminRoleRepository: Repository<AdminRole>,
    private readonly auditLogService: AuditLogService,
    private readonly access: AdminAccessService,
    @InjectRepository(Admin) private readonly admins: Repository<Admin>,
  ) {}

  async create(dto: CreateAdminRoleDto, actorId: string): Promise<AdminRole> {
    await this.assertDelegation(actorId, dto.permissions);
    const exists = await this.adminRoleRepository.existsBy({ name: dto.name });
    if (exists)
      throw new ConflictException(`Admin role "${dto.name}" already exists.`);

    const role = this.adminRoleRepository.create({
      name: dto.name,
      description: dto.description,
      permissions: dto.permissions,
    });
    const saved = await this.adminRoleRepository.save(role);
    this.logger.log(
      `Admin role "${saved.name}" created (id: ${saved.id}) by actor ${actorId}`,
    );
    this.auditLogService.log('ADMIN_ROLE_CREATED', {
      actorId,
      targetId: saved.id,
      targetName: saved.name,
      metadata: { name: saved.name, permissionCount: saved.permissions.length },
    });
    return saved;
  }

  async update(
    id: string,
    dto: UpdateAdminRoleDto,
    actorId: string,
  ): Promise<AdminRole> {
    const role = await this.getById(id);
    await this.assertDelegation(
      actorId,
      dto.permissions ?? role.permissions,
      id,
    );

    if (dto.name && dto.name !== role.name) {
      const exists = await this.adminRoleRepository.existsBy({
        name: dto.name,
      });
      if (exists)
        throw new ConflictException(`Admin role "${dto.name}" already exists.`);
      role.name = dto.name;
    }
    if (dto.description !== undefined) role.description = dto.description;
    if (dto.permissions !== undefined) role.permissions = dto.permissions;

    const saved = await this.adminRoleRepository.save(role);
    this.logger.log(
      `Admin role "${saved.name}" updated (id: ${id}) by actor ${actorId}`,
    );
    this.auditLogService.log('ADMIN_ROLE_UPDATED', {
      actorId,
      targetId: id,
      targetName: saved.name,
      metadata: { name: saved.name, changes: Object.keys(dto) },
    });
    return saved;
  }

  async delete(id: string, actorId: string): Promise<void> {
    const role = await this.adminRoleRepository.findOne({
      where: { id },
      relations: ['admins'],
    });
    if (!role) throw new NotFoundException('Admin role not found.');

    const activeAdmins = role.admins?.filter((a) => a.isActive).length ?? 0;
    if (activeAdmins > 0) {
      this.logger.warn(
        `Delete of admin role "${role.name}" blocked — ${activeAdmins} active admin(s) still assigned`,
      );
      throw new BadRequestException(
        'Cannot delete a role that has active admin users. Reassign or deactivate them first.',
      );
    }

    const { name } = role;
    await this.adminRoleRepository.remove(role);
    this.logger.log(
      `Admin role "${name}" deleted (id: ${id}) by actor ${actorId}`,
    );
    this.auditLogService.log('ADMIN_ROLE_DELETED', {
      actorId,
      targetId: id,
      targetName: name,
      metadata: { name },
    });
  }

  private async assertDelegation(
    actorId: string,
    permissions: AdminPermission[],
    roleId?: string,
  ): Promise<void> {
    if (!(await this.access.isOn())) return;
    const actor = await this.admins.findOne({
      where: { member: { id: actorId }, isActive: true },
      relations: ['adminRole'],
    });
    await this.access.assertCanDelegate(actor, permissions);
    if (
      roleId &&
      !actor.isOwner &&
      (await this.admins.existsBy({ adminRole: { id: roleId }, isOwner: true }))
    ) {
      throw new ForbiddenException(
        'Only an account owner can change a role assigned to an owner.',
      );
    }
  }

  async getAll(): Promise<AdminRole[]> {
    return this.adminRoleRepository.find({ order: { name: 'ASC' } });
  }

  async getById(id: string): Promise<AdminRole> {
    const role = await this.adminRoleRepository.findOneBy({ id });
    if (!role) throw new NotFoundException('Admin role not found.');
    return role;
  }

  async findOrCreateSuperAdmin(): Promise<AdminRole> {
    const existing = await this.adminRoleRepository.findOneBy({
      name: 'SuperAdmin',
    });
    if (existing) return existing;

    this.logger.log('SuperAdmin role not found — seeding');
    const { AdminPermission } = await import('../enum/admin-permission.enum');
    return this.adminRoleRepository.save(
      this.adminRoleRepository.create({
        name: 'SuperAdmin',
        description: 'Full access to all admin features.',
        permissions: Object.values(AdminPermission),
      }),
    );
  }
}
