import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { NetworkOverseer } from './network-overseer.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { CacheService } from '../utility/service/cache.service';
import { AuditLogService } from '../utility/service/audit-log.service';
import { AppClsStore } from '../tenant/interface/tenant-cls-store.interface';
import { SessionSurface } from '../auth/enum/session-surface.enum';
import { MemberRoleEnum } from '../member/enums/member-role.enum';
import type { JwtPayload, MemberAuth } from '../auth/interface/auth.interface';
import type { Admin } from '../admin/entity/admin.entity';
import {
  OVERSEER_PASS_SECONDS,
  OVERSEER_VIEW_LOG_SECONDS,
  overseerBranchKey,
  overseerKey,
  overseerPermissions,
} from './overseer.constants';

const CACHE_SECONDS = 300;

export interface OverseerAuth extends MemberAuth {
  overseer: { id: string; name: string; email: string; networkRootId: string };
}

type CachedOverseer = Pick<
  NetworkOverseer,
  'id' | 'name' | 'email' | 'networkRootId'
>;
type CachedBranch = { networkRootId: string | null; sharesGiving: boolean };

export const isOverseer = (user?: MemberAuth | null): user is OverseerAuth =>
  user?.surface === SessionSurface.OVERSEER;

// Overseer passes: who holds one, what they may read and the branch's log of what they opened.
@Injectable()
export class OverseerAccessService {
  constructor(
    @InjectRepository(NetworkOverseer)
    private readonly overseers: Repository<NetworkOverseer>,
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    private readonly jwt: JwtService,
    private readonly cache: CacheService,
    private readonly audit: AuditLogService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  async issuePass(
    overseerId: string,
    branch: Pick<Tenant, 'id' | 'schemaName'>,
  ): Promise<{ access_token: string; expires_in: number; token_type: string }> {
    const payload: JwtPayload = {
      sub: overseerId,
      role: MemberRoleEnum.MEMBER,
      aud: SessionSurface.OVERSEER,
      jti: randomUUID(),
      tenantId: branch.id,
      schemaName: branch.schemaName,
    };
    return {
      access_token: await this.jwt.signAsync(payload, {
        expiresIn: OVERSEER_PASS_SECONDS,
      }),
      expires_in: OVERSEER_PASS_SECONDS,
      token_type: 'Bearer',
    };
  }

  // A pass is good only at the branch it names, while its holder is still an overseer of that branch's network.
  async validatePass(payload: JwtPayload): Promise<OverseerAuth> {
    const here = this.cls.get('tenantId');
    if (!payload.tenantId || payload.tenantId !== here) {
      throw new UnauthorizedException('This pass is for another church.');
    }
    const [overseer, branch] = await Promise.all([
      this.overseer(payload.sub),
      this.branch(here),
    ]);
    if (
      !overseer ||
      !branch.networkRootId ||
      branch.networkRootId !== overseer.networkRootId ||
      here === overseer.networkRootId
    ) {
      throw new UnauthorizedException('Your overseer access has ended.');
    }
    return {
      id: overseer.id,
      role: MemberRoleEnum.MEMBER,
      requiresPasswordChange: false,
      surface: SessionSurface.OVERSEER,
      jti: payload.jti,
      overseer,
    };
  }

  // Stands in for an admin record: a fixed read-only role, never an owner, nothing of its own in this church.
  async adminFor(user: OverseerAuth): Promise<Admin> {
    const branch = await this.branch(this.cls.get('tenantId'));
    const [firstname, ...rest] = user.overseer.name.split(' ');
    return {
      id: user.overseer.id,
      isActive: true,
      isOwner: false,
      ownerInvitedAt: null,
      twoFactorEnabledAt: null,
      favouritePages: [],
      overseer: true,
      adminRole: {
        id: 'overseer',
        name: 'Overseer',
        description: 'Read-only view for the network',
        permissions: overseerPermissions(branch.sharesGiving),
      },
      member: {
        id: user.overseer.id,
        firstname,
        lastname: rest.join(' '),
        email: user.overseer.email,
        appearanceMode: 'light',
        useChurchTheme: true,
      },
    } as unknown as Admin;
  }

  // Refused before the handler runs; the request's transaction is then read-only too, so a page that writes as it loads can't.
  async assertReadOnly(req: Request): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      throw new ForbiddenException({
        message: 'Overseers can look but not change anything here.',
        code: 'OVERSEER_READ_ONLY',
      });
    }
    await this.txHost.tx.query('SET LOCAL transaction_read_only = on');
  }

  // Each page (by its address) is logged once per 10 minutes, so the branch's log stays readable.
  async recordView(user: OverseerAuth, req: Request): Promise<void> {
    const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
    const seen = await this.cache.incr(
      `overseer-view:${user.overseer.id}:${path}`,
      OVERSEER_VIEW_LOG_SECONDS,
    );
    if (seen !== 1) return;
    this.audit.log('OVERSEER_VIEWED', {
      targetName: user.overseer.name,
      targetEmail: user.overseer.email,
      metadata: { overseerId: user.overseer.id, path },
    });
  }

  async forget(overseerId: string): Promise<void> {
    await this.cache.delGlobal(overseerKey(overseerId));
  }

  private async overseer(id: string): Promise<CachedOverseer | null> {
    const key = overseerKey(id);
    const cached = await this.cache.getGlobal<CachedOverseer | false>(key);
    if (cached !== undefined) return cached || null;
    const row = await this.overseers.findOne({
      where: { id },
      select: { id: true, name: true, email: true, networkRootId: true },
    });
    this.cache.setGlobal(key, row ?? false, CACHE_SECONDS);
    return row;
  }

  private async branch(tenantId: string): Promise<CachedBranch> {
    const key = overseerBranchKey(tenantId);
    const cached = await this.cache.getGlobal<CachedBranch>(key);
    if (cached) return cached;
    const row = await this.tenants.findOne({
      where: { id: tenantId },
      select: { id: true, networkRootId: true, shareGivingWithParent: true },
    });
    const value: CachedBranch = {
      networkRootId: row?.networkRootId ?? null,
      sharesGiving: !!row?.shareGivingWithParent,
    };
    this.cache.setGlobal(key, value, CACHE_SECONDS);
    return value;
  }
}
