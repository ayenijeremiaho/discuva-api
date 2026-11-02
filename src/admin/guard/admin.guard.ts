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
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import {
  CHURCH_WIDE_ONLY_KEY,
  SCOPED_MEMBER_PARAM_KEY,
  effectivePermissions,
} from '../../campus/campus-scope';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(Admin)
    private readonly adminRepository: Repository<Admin>,
    private readonly cls: ClsService<AppClsStore>,
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

    // Owners look after the whole church even when also given a campus.
    const scope = admin.isOwner
      ? []
      : (
          (await this.adminRepository.query(
            'SELECT campus_id AS "campusId" FROM campus_admins WHERE admin_id = $1',
            [admin.id],
          )) as { campusId: string }[]
        ).map((r) => r.campusId);
    admin.adminRole.permissions = effectivePermissions(
      admin.adminRole.permissions,
      scope.length > 0,
    );
    if (scope.length) {
      if (this.cls.isActive()) this.cls.set('campusScope', scope);
      const churchWideOnly = this.reflector.getAllAndOverride<boolean>(
        CHURCH_WIDE_ONLY_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (churchWideOnly) {
        throw new ForbiddenException(
          'Only admins who look after the whole church can do this.',
        );
      }
      await this.assertMemberInScope(context, request, scope);
    }
    request.campusScope = scope;

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

  private async assertMemberInScope(
    context: ExecutionContext,
    request: any,
    scope: string[],
  ): Promise<void> {
    const param = this.reflector.getAllAndOverride<string>(
      SCOPED_MEMBER_PARAM_KEY,
      [context.getHandler(), context.getClass()],
    );
    const memberId: unknown = param ? request.params?.[param] : undefined;
    if (typeof memberId !== 'string' || !UUID.test(memberId)) return;
    const [row] = (await this.adminRepository.query(
      'SELECT home_campus_id AS "campusId" FROM members WHERE id = $1',
      [memberId],
    )) as { campusId: string | null }[];
    if (row?.campusId && !scope.includes(row.campusId)) {
      throw new ForbiddenException(
        "This person belongs to another campus. Their campus's admins look after them.",
      );
    }
  }
}
