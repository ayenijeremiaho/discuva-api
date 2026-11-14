import { AdminAccessService } from '../service/admin-access.service';
import { REQUIRES_OWNER_KEY } from '../decorator/requires-owner.decorator';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Admin } from '../entity/admin.entity';
import { AdminPermission } from '../enum/admin-permission.enum';
import { REQUIRES_PERMISSION_KEY } from '../decorator/requires-permission.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { SessionSurface } from '../../auth/enum/session-surface.enum';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AdminAccessService,
    @InjectRepository(Admin)
    private readonly adminRepository: Repository<Admin>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user: MemberAuth = request.user;

    if (!user?.id) throw new UnauthorizedException();

    if (user.surface !== SessionSurface.ADMIN) {
      throw new ForbiddenException(
        'Admin portal access requires an admin token.',
      );
    }

    const admin = await this.adminRepository.findOne({
      where: { member: { id: user.id }, isActive: true },
      relations: ['adminRole', 'member'],
    });

    if (!admin) throw new ForbiddenException('Admin access required.');

    const required = this.reflector.getAllAndOverride<AdminPermission>(
      REQUIRES_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (required && !(await this.access.has(admin, required))) {
      throw new ForbiddenException(`Missing required permission: ${required}`);
    }

    const ownerOnly = this.reflector.getAllAndOverride<boolean>(
      REQUIRES_OWNER_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (ownerOnly && !admin.isOwner) {
      throw new ForbiddenException('Only an account owner can do this.');
    }

    if (admin.member) {
      delete (admin.member as any).password;
      delete (admin.member as any).deviceId;
    }
    request.admin = admin;
    return true;
  }
}
