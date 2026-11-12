import { REQUIRES_OWNER_KEY } from '../decorator/requires-owner.decorator';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
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
import { OPEN_TO_OVERSEERS } from '../../network-overseer/open-to-overseers.decorator';
import {
  isOverseer,
  OverseerAccessService,
} from '../../network-overseer/overseer-access.service';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(Admin)
    private readonly adminRepository: Repository<Admin>,
    @Optional() private readonly overseers?: OverseerAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user: MemberAuth = request.user;

    if (!user?.id) throw new UnauthorizedException();

    if (isOverseer(user)) return this.overseerCanActivate(context, user);

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

    if (required && !admin.adminRole.permissions.includes(required)) {
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

  // Read-only, within the fixed Overseer role, and every page opened goes in the branch's log.
  private async overseerCanActivate(
    context: ExecutionContext,
    user: Parameters<OverseerAccessService['adminFor']>[0],
  ): Promise<boolean> {
    if (!this.overseers) throw new ForbiddenException('Admin access required.');
    const request = context.switchToHttp().getRequest();
    await this.overseers.assertReadOnly(request);
    const ownerOnly = this.reflector.getAllAndOverride<boolean>(
      REQUIRES_OWNER_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (ownerOnly) {
      throw new ForbiddenException('Only an account owner can do this.');
    }
    const admin = await this.overseers.adminFor(user);
    const required = this.reflector.getAllAndOverride<AdminPermission>(
      REQUIRES_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    const open = this.reflector.getAllAndOverride<boolean>(OPEN_TO_OVERSEERS, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required ? !admin.adminRole.permissions.includes(required) : !open) {
      throw new ForbiddenException({
        message: "That's private to the branch, so overseers can't open it.",
        code: 'OVERSEER_NOT_SHOWN',
      });
    }
    await this.overseers.recordView(user, request);
    request.admin = admin;
    return true;
  }
}
