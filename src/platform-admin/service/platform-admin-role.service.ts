import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformAdminRole } from '../entity/platform-admin-role.entity';
import {
  CreatePlatformAdminRoleDto,
  UpdatePlatformAdminRoleDto,
} from '../dto/platform-admin-role.dto';
import { PlatformAdminPermission } from '../enum/platform-admin-permission.enum';

// Mirrors src/admin/service/admin-role.service.ts's shape exactly, for the
// separate platform-admin identity system. No audit-log tie-in — unlike
// tenant AdminRoleService, which logs into a tenant-scoped audit_logs table,
// there's no tenant context here to write into, and platform-admin actions
// aren't audited anywhere else in this codebase today either.
@Injectable()
export class PlatformAdminRoleService {
  private readonly logger = new Logger(PlatformAdminRoleService.name);

  constructor(
    @InjectRepository(PlatformAdminRole)
    private readonly roleRepo: Repository<PlatformAdminRole>,
  ) {}

  async getAll(): Promise<PlatformAdminRole[]> {
    return this.roleRepo.find({ order: { name: 'ASC' } });
  }

  async getById(id: string): Promise<PlatformAdminRole> {
    const role = await this.roleRepo.findOneBy({ id });
    if (!role) throw new NotFoundException('Platform admin role not found.');
    return role;
  }

  async create(dto: CreatePlatformAdminRoleDto): Promise<PlatformAdminRole> {
    const exists = await this.roleRepo.existsBy({ name: dto.name });
    if (exists) {
      throw new ConflictException(
        `Platform admin role "${dto.name}" already exists.`,
      );
    }
    const role = this.roleRepo.create({
      name: dto.name,
      description: dto.description,
      permissions: dto.permissions,
    });
    const saved = await this.roleRepo.save(role);
    this.logger.log(
      `Platform admin role "${saved.name}" created (id: ${saved.id})`,
    );
    return saved;
  }

  async update(
    id: string,
    dto: UpdatePlatformAdminRoleDto,
  ): Promise<PlatformAdminRole> {
    const role = await this.getById(id);

    if (dto.name && dto.name !== role.name) {
      const exists = await this.roleRepo.existsBy({ name: dto.name });
      if (exists) {
        throw new ConflictException(
          `Platform admin role "${dto.name}" already exists.`,
        );
      }
      role.name = dto.name;
    }
    if (dto.description !== undefined) role.description = dto.description;
    if (dto.permissions !== undefined) role.permissions = dto.permissions;

    const saved = await this.roleRepo.save(role);
    this.logger.log(`Platform admin role "${saved.name}" updated (id: ${id})`);
    return saved;
  }

  async delete(id: string): Promise<void> {
    const role = await this.roleRepo.findOne({
      where: { id },
      relations: ['admins'],
    });
    if (!role) throw new NotFoundException('Platform admin role not found.');

    const activeAdmins = role.admins?.filter((a) => a.isActive).length ?? 0;
    if (activeAdmins > 0) {
      throw new BadRequestException(
        'Cannot delete a role that has active platform admins. Reassign or deactivate them first.',
      );
    }

    await this.roleRepo.remove(role);
    this.logger.log(`Platform admin role "${role.name}" deleted (id: ${id})`);
  }

  async findOrCreateSuperAdmin(): Promise<PlatformAdminRole> {
    const existing = await this.roleRepo.findOneBy({ name: 'SuperAdmin' });
    if (existing) return existing;

    this.logger.log('SuperAdmin platform admin role not found — seeding');
    return this.roleRepo.save(
      this.roleRepo.create({
        name: 'SuperAdmin',
        description: 'Full access to all platform admin features.',
        permissions: Object.values(PlatformAdminPermission),
      }),
    );
  }
}
