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
import { Tenant } from '../../tenant/entity/tenant.entity';
import { TenantOnboardingStatus } from '../../tenant/enum/tenant-onboarding-status.enum';
import { Admin } from '../../admin/entity/admin.entity';
import { NetworkOverseer } from '../../network-overseer/network-overseer.entity';
import { OverseerAccessService } from '../../network-overseer/overseer-access.service';
import { NETWORK_OVERSEER_MAX } from '../../network-overseer/overseer.constants';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { NetworkService } from './network.service';

export interface OverseersView {
  overseers: Pick<
    NetworkOverseer,
    'id' | 'name' | 'email' | 'addedByName' | 'createdAt'
  >[];
  max: number;
  // This admin is one of them, so the network page offers "Look inside".
  youAreOverseer: boolean;
  canManage: boolean;
  // Admins of the top church who could be named; only for its owners.
  candidates: { adminId: string; name: string; email: string }[];
}

// Overseers are named by the top church's owners, from its own admins; each can open any branch read-only.
@Injectable()
export class NetworkOverseerService {
  constructor(
    @InjectRepository(NetworkOverseer)
    private readonly overseers: Repository<NetworkOverseer>,
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    @InjectRepository(Admin)
    private readonly admins: Repository<Admin>,
    private readonly access: OverseerAccessService,
    private readonly network: NetworkService,
    private readonly audit: AuditLogService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async view(admin: Admin): Promise<OverseersView> {
    const here = await this.here();
    const rootId = here.networkRootId!;
    const overseers = await this.overseers.find({
      where: { networkRootId: rootId },
      select: {
        id: true,
        name: true,
        email: true,
        addedByName: true,
        createdAt: true,
        memberId: true,
      },
      order: { createdAt: 'ASC' },
    });
    const atTop = here.id === rootId;
    const canManage = atTop && admin.isOwner;
    const named = new Set(overseers.map((o) => o.memberId));
    return {
      overseers: overseers.map(({ memberId: _m, ...o }) => o),
      max: NETWORK_OVERSEER_MAX,
      youAreOverseer: atTop && named.has(admin.member?.id),
      canManage,
      candidates: canManage
        ? (await this.activeAdmins())
            .filter((a) => !named.has(a.member.id))
            .map((a) => ({
              adminId: a.id,
              name: fullName(a),
              email: a.member.email,
            }))
        : [],
    };
  }

  async add(admin: Admin, adminId: string): Promise<OverseersView> {
    const rootId = await this.assertTopOwner(admin);
    const count = await this.overseers.count({
      where: { networkRootId: rootId },
    });
    if (count >= NETWORK_OVERSEER_MAX) {
      throw new BadRequestException(
        `A network can have up to ${NETWORK_OVERSEER_MAX} overseers.`,
      );
    }
    const chosen = await this.admins.findOne({
      where: { id: adminId, isActive: true },
      relations: { member: true },
    });
    if (!chosen?.member) throw new NotFoundException('Admin not found.');
    const inserted = await this.overseers
      .createQueryBuilder()
      .insert()
      .values({
        networkRootId: rootId,
        memberId: chosen.member.id,
        name: fullName(chosen),
        email: chosen.member.email,
        addedByName: fullName(admin),
      })
      .orIgnore()
      .returning(['id'])
      .execute();
    if (!inserted.raw?.length) {
      throw new ConflictException('They are already an overseer.');
    }
    this.audit.log('NETWORK_OVERSEER_ADDED', {
      actorId: admin.member?.id,
      targetId: chosen.member.id,
      targetEmail: chosen.member.email,
      targetName: fullName(chosen),
    });
    return this.view(admin);
  }

  // Owners of the top church remove anyone; an overseer can step down themselves.
  async remove(admin: Admin, id: string): Promise<OverseersView> {
    const here = await this.here();
    const row = await this.overseers.findOne({
      where: { id, networkRootId: here.networkRootId! },
    });
    if (!row || here.id !== here.networkRootId) {
      throw new NotFoundException('Overseer not found.');
    }
    if (!admin.isOwner && row.memberId !== admin.member?.id) {
      throw new ForbiddenException(
        'Only owners of the top church can remove an overseer.',
      );
    }
    await this.overseers.delete({ id: row.id });
    await this.access.forget(row.id);
    this.audit.log('NETWORK_OVERSEER_REMOVED', {
      actorId: admin.member?.id,
      targetId: row.memberId,
      targetEmail: row.email,
      targetName: row.name,
    });
    return this.view(admin);
  }

  // A 15-minute read-only pass for one branch, asked for from the overseer's own seat at the top church.
  async pass(admin: Admin, tenantId: string) {
    const here = await this.here();
    const rootId = here.networkRootId!;
    const row =
      here.id === rootId && admin.member?.id
        ? await this.overseers.findOne({
            where: { networkRootId: rootId, memberId: admin.member.id },
            select: { id: true },
          })
        : null;
    if (!row) {
      throw new ForbiddenException(
        'Only network overseers can look inside a branch.',
      );
    }
    const branch = await this.tenants.findOne({
      where: { id: tenantId, networkRootId: rootId },
      select: {
        id: true,
        name: true,
        subdomain: true,
        schemaName: true,
        isActive: true,
        closedAt: true,
        onboardingStatus: true,
      },
    });
    if (
      !branch ||
      branch.id === rootId ||
      branch.onboardingStatus !== TenantOnboardingStatus.ACTIVE ||
      (!branch.isActive && !branch.closedAt)
    ) {
      throw new NotFoundException('Branch not found.');
    }
    const path = (await this.network.pathsOf(rootId, [branch.id])).get(
      branch.id,
    );
    return {
      ...(await this.access.issuePass(row.id, branch)),
      branch: {
        id: branch.id,
        name: branch.name,
        subdomain: branch.subdomain,
        path: path ?? branch.name,
        closedAt: branch.closedAt,
      },
    };
  }

  private async assertTopOwner(admin: Admin): Promise<string> {
    const here = await this.here();
    if (here.id !== here.networkRootId || !admin.isOwner) {
      throw new ForbiddenException(
        'Only owners of the top church can name overseers.',
      );
    }
    return here.id;
  }

  private activeAdmins(): Promise<Admin[]> {
    return this.admins.find({
      where: { isActive: true },
      relations: { member: true },
      select: {
        id: true,
        member: { id: true, firstname: true, lastname: true, email: true },
      },
      order: { createdAt: 'ASC' },
    });
  }

  private async here(): Promise<Tenant> {
    const here = await this.tenants.findOne({
      where: { id: this.cls.get('tenantId') },
      select: { id: true, networkRootId: true },
    });
    if (!here?.networkRootId)
      throw new NotFoundException('Your church is not part of a network.');
    return here;
  }
}

const fullName = (a: Admin) =>
  `${a.member?.firstname ?? ''} ${a.member?.lastname ?? ''}`.trim();
