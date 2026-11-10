import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { In, Repository } from 'typeorm';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { TenantVerificationStatus } from '../../tenant/enum/tenant-verification-status.enum';
import { OrganisationTypeEnum } from '../../tenant/enum/organisation-type.enum';
import { TenantOnboardingStatus } from '../../tenant/enum/tenant-onboarding-status.enum';
import { TenantOnboardingActorType } from '../../tenant/enum/tenant-onboarding-actor-type.enum';
import { TenantProvisioningService } from '../../tenant/service/tenant-provisioning.service';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { Subscription } from '../../billing/entity/subscription.entity';
import { isFreePlan } from '../../billing/util/free-plan.util';
import { Admin } from '../../admin/entity/admin.entity';
import { DiscuvaAccountService } from '../../discuva-account/service/discuva-account.service';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';
import { PlatformSettingKey } from '../../platform-admin/enum/platform-setting-key.enum';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { NetworkLevel } from '../entity/network-level.entity';
import { NetworkMove } from '../entity/network-move.entity';
import { TenantRollup } from '../entity/tenant-rollup.entity';
import { AddBranchDto } from '../dto/network.dto';

const MAX_ADDRESS_TRIES = 20;
const RECENT_MOVES = 5;

export interface NetworkNode {
  id: string;
  name: string;
  subdomain: string;
  label: string;
  parentId: string | null;
  depth: number;
  levelName: string | null;
  path: string;
  childCount: number;
  isActive: boolean;
}

export interface NetworkView {
  available: boolean;
  inNetwork: boolean;
  // Whether this church may add a branch under itself right now (owners only, verified networks).
  canAddBranch: boolean;
  reasonCannotAdd: string | null;
  isTop: boolean;
  me: NetworkNode | null;
  // This church's chain up to the top, then everything under it; nothing elsewhere in the network.
  ancestors: NetworkNode[];
  nodes: NetworkNode[];
  levels: string[];
  maxLevels: number;
  recentMoves: {
    church: string;
    from: string | null;
    to: string | null;
    at: Date;
  }[];
}

type TreeRow = Pick<
  Tenant,
  | 'id'
  | 'name'
  | 'subdomain'
  | 'parentTenantId'
  | 'networkLabel'
  | 'networkRootId'
  | 'isActive'
>;

interface Tree {
  rootId: string;
  byId: Map<string, TreeRow>;
  children: Map<string, string[]>;
}

// "abc" + "Lagos Island" → "abc-lagos-island"; the network's address plus the church's own label, never the path.
export function branchAddress(rootSubdomain: string, label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${rootSubdomain}-${slug}`.slice(0, 60).replace(/-+$/, '');
}

@Injectable()
export class NetworkService {
  private readonly logger = new Logger(NetworkService.name);

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(NetworkLevel)
    private readonly levelRepo: Repository<NetworkLevel>,
    @InjectRepository(NetworkMove)
    private readonly moveRepo: Repository<NetworkMove>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    @InjectRepository(TenantRollup)
    private readonly rollupRepo: Repository<TenantRollup>,
    private readonly provisioning: TenantProvisioningService,
    private readonly accounts: DiscuvaAccountService,
    private readonly settings: PlatformSettingsService,
    private readonly auditLog: AuditLogService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  isAvailable(): Promise<boolean> {
    return this.accounts.readModeOn(PlatformSettingKey.CHURCH_NETWORK_MODE);
  }

  async view(admin: Admin): Promise<NetworkView> {
    const [available, maxLevels, current] = await Promise.all([
      this.isAvailable(),
      this.maxLevels(),
      this.currentTenant(),
    ]);
    const empty: NetworkView = {
      available,
      inNetwork: false,
      canAddBranch: false,
      reasonCannotAdd: null,
      isTop: false,
      me: null,
      ancestors: [],
      nodes: [],
      levels: [],
      maxLevels,
      recentMoves: [],
    };
    if (!available) return empty;

    if (!current.networkRootId) {
      const reason = this.cannotStart(current, admin);
      return {
        ...empty,
        canAddBranch: !reason,
        reasonCannotAdd: reason,
        isTop: true,
      };
    }

    const [tree, levels] = await Promise.all([
      this.loadTree(current.networkRootId),
      this.levelNames(current.networkRootId),
    ]);
    const node = (id: string) => this.toNode(tree, id, levels);
    const ancestors = this.ancestorIds(tree, current.id).reverse().map(node);
    const nodes = this.subtreeIds(tree, current.id).map(node);
    const me = node(current.id);
    const reason = !admin.isOwner
      ? 'Only owners can add branches.'
      : me.depth >= maxLevels
        ? `This network allows ${maxLevels} levels.`
        : null;

    const moves = await this.moveRepo.find({
      where: {
        networkRootId: tree.rootId,
        tenantId: In(nodes.map((n) => n.id)),
      },
      order: { createdAt: 'DESC' },
      take: RECENT_MOVES,
    });
    const nameOf = (id: string | null) =>
      id && tree.byId.has(id) ? node(id).path : null;

    return {
      available,
      inNetwork: true,
      canAddBranch: !reason,
      reasonCannotAdd: reason,
      isTop: current.id === tree.rootId,
      me,
      ancestors,
      nodes,
      levels: this.levelList(levels, maxLevels),
      maxLevels,
      recentMoves: moves.map((m) => ({
        church: nameOf(m.tenantId) ?? '',
        from: nameOf(m.fromParentId),
        to: nameOf(m.toParentId),
        at: m.createdAt,
      })),
    };
  }

  // The address a new branch would get, for the form's preview.
  async previewAddress(label: string): Promise<{ subdomain: string }> {
    const current = await this.currentTenant();
    const root = current.networkRootId
      ? await this.tenantRepo.findOneByOrFail({ id: current.networkRootId })
      : current;
    return { subdomain: await this.freeAddress(root.subdomain, label) };
  }

  async addBranch(admin: Admin, dto: AddBranchDto): Promise<NetworkNode> {
    await this.assertAvailable();
    const current = await this.currentTenant();
    const maxLevels = await this.maxLevels();

    let rootId = current.networkRootId;
    if (!rootId) {
      const reason = this.cannotStart(current, admin);
      if (reason) throw new ForbiddenException(reason);
      rootId = current.id;
    } else if (!admin.isOwner) {
      throw new ForbiddenException('Only owners can add branches.');
    }
    const root =
      rootId === current.id
        ? current
        : await this.tenantRepo.findOneByOrFail({ id: rootId });

    const tree = await this.loadTree(rootId);
    const depth = current.networkRootId ? this.depthOf(tree, current.id) : 1;
    if (depth >= maxLevels)
      throw new BadRequestException(
        `This network allows ${maxLevels} levels, so nothing can be added under this church.`,
      );

    const subdomain = await this.freeAddress(root.subdomain, dto.label);
    const sponsoredPlanId = dto.sponsor
      ? await this.sponsorablePlan(current.id)
      : undefined;

    if (!current.networkRootId) {
      await this.tenantRepo.update(current.id, { networkRootId: current.id });
    }

    let branch: Tenant;
    try {
      branch = await this.provisioning.provision({
        subdomain,
        churchName: dto.name.trim(),
        adminFirstname: dto.ownerFirstname.trim(),
        adminLastname: dto.ownerLastname.trim(),
        adminEmail: dto.ownerEmail.trim().toLowerCase(),
        planId: 'free',
        parentTenantId: current.id,
        sponsoredPlanId,
      });
    } catch (err) {
      this.logger.error(`Adding branch "${subdomain}" failed`, err);
      throw err;
    }

    await this.tenantRepo.update(branch.id, {
      networkRootId: rootId,
      networkLabel: dto.label.trim(),
      orgType: root.orgType,
      verificationStatus: root.verificationStatus,
      verifiedAt: root.verifiedAt,
      themePreset: root.themePreset,
      onboardingStatus: TenantOnboardingStatus.ACTIVE,
      activatedAt: new Date(),
    });
    await this.provisioning.recordEvent(
      branch.id,
      'NETWORK_BRANCH_CREATED',
      TenantOnboardingActorType.SELF_SERVE,
      { actorId: admin.id, metadata: { parentTenantId: current.id } },
    );
    this.auditLog.log('NETWORK_BRANCH_ADDED', {
      targetId: branch.id,
      targetName: dto.name,
      metadata: { subdomain, sponsored: !!sponsoredPlanId },
    });

    const levels = await this.levelNames(rootId);
    return this.toNode(await this.loadTree(rootId), branch.id, levels);
  }

  // Moves a church, with everything under it, under another church in the same network. Its address never changes.
  async moveChurch(
    admin: Admin,
    churchId: string,
    newParentId: string,
    memberId: string,
  ): Promise<NetworkNode> {
    await this.assertAvailable();
    if (!admin.isOwner)
      throw new ForbiddenException('Only owners can move churches.');
    const current = await this.currentTenant();
    if (!current.networkRootId)
      throw new NotFoundException('This church isn’t in a network.');
    const tree = await this.loadTree(current.networkRootId);
    const church = tree.byId.get(churchId);
    const newParent = tree.byId.get(newParentId);
    if (!church || !newParent)
      throw new NotFoundException('Both churches must be in this network.');
    if (church.id === tree.rootId)
      throw new BadRequestException('The top church can’t be moved.');
    if (church.parentTenantId === newParent.id)
      return this.nodeFor(tree, church.id);

    const mine = new Set(this.subtreeIds(tree, current.id));
    if (
      church.id === current.id ||
      !mine.has(church.parentTenantId!) ||
      !mine.has(newParent.id)
    )
      throw new ForbiddenException(
        'You can move churches only between places under your own church.',
      );
    if (this.subtreeIds(tree, church.id).includes(newParent.id))
      throw new BadRequestException(
        'A church can’t be moved under one of its own branches.',
      );
    const maxLevels = await this.maxLevels();
    if (
      this.depthOf(tree, newParent.id) + this.heightOf(tree, church.id) >
      maxLevels
    )
      throw new BadRequestException(
        `That would go past the ${maxLevels} levels this network allows.`,
      );

    const fromParentId = church.parentTenantId;
    await this.tenantRepo.update(church.id, { parentTenantId: newParent.id });
    await this.moveRepo.save(
      this.moveRepo.create({
        networkRootId: tree.rootId,
        tenantId: church.id,
        fromParentId,
        toParentId: newParent.id,
        movedByTenantId: current.id,
        movedByMemberId: memberId,
      }),
    );
    this.auditLog.log('NETWORK_CHURCH_MOVED', {
      targetId: church.id,
      targetName: church.name,
      metadata: { fromParentId, toParentId: newParent.id },
    });
    return this.nodeFor(await this.loadTree(tree.rootId), church.id);
  }

  async setLevels(admin: Admin, names: string[]): Promise<string[]> {
    await this.assertAvailable();
    const current = await this.currentTenant();
    if (!admin.isOwner || current.networkRootId !== current.id)
      throw new ForbiddenException(
        'Only owners of the top church can name the levels.',
      );
    const maxLevels = await this.maxLevels();
    const cleaned = names.map((n) => n.trim()).slice(0, maxLevels - 1);
    await this.levelRepo.delete({ networkRootId: current.id });
    const rows = cleaned
      .map((name, i) => ({ networkRootId: current.id, depth: i + 2, name }))
      .filter((r) => r.name);
    if (rows.length) await this.levelRepo.save(rows);
    return this.levelList(await this.levelNames(current.id), maxLevels);
  }

  // Console: every network, with its size and depth. Structure and figures only, never anyone's details.
  async platformNetworks(): Promise<
    {
      rootId: string;
      name: string;
      subdomain: string;
      churches: number;
      levels: number;
    }[]
  > {
    const roots = await this.tenantRepo
      .createQueryBuilder('t')
      .select(['t.id', 't.name', 't.subdomain'])
      .where('t.network_root_id = t.id')
      .orderBy('t.name', 'ASC')
      .getMany();
    if (!roots.length) return [];
    const trees = await Promise.all(roots.map((r) => this.loadTree(r.id)));
    return roots.map((r, i) => ({
      rootId: r.id,
      name: r.name,
      subdomain: r.subdomain,
      churches: trees[i].byId.size,
      levels: this.heightOf(trees[i], r.id),
    }));
  }

  async platformNetwork(rootId: string): Promise<{
    nodes: (NetworkNode & { memberCount: number | null })[];
    levels: string[];
    moves: NetworkView['recentMoves'];
  }> {
    const [tree, levels, maxLevels] = await Promise.all([
      this.loadTree(rootId),
      this.levelNames(rootId),
      this.maxLevels(),
    ]);
    if (!tree.byId.has(rootId))
      throw new NotFoundException('Network not found');
    const ids = this.subtreeIds(tree, rootId);
    const [rollups, moves] = await Promise.all([
      this.rollupRepo.find({
        where: { tenantId: In(ids) },
        select: { tenantId: true, memberCount: true },
      }),
      this.moveRepo.find({
        where: { networkRootId: rootId },
        order: { createdAt: 'DESC' },
        take: 20,
      }),
    ]);
    const members = new Map(rollups.map((r) => [r.tenantId, r.memberCount]));
    const path = (id: string | null) =>
      id && tree.byId.has(id) ? this.toNode(tree, id, levels).path : null;
    return {
      nodes: ids.map((id) => ({
        ...this.toNode(tree, id, levels),
        memberCount: members.get(id) ?? null,
      })),
      levels: this.levelList(levels, maxLevels),
      moves: moves.map((m) => ({
        church: path(m.tenantId) ?? '',
        from: path(m.fromParentId),
        to: path(m.toParentId),
        at: m.createdAt,
      })),
    };
  }

  private cannotStart(tenant: Tenant, admin: Admin): string | null {
    if (tenant.orgType !== OrganisationTypeEnum.CHURCH)
      return 'Networks are for churches.';
    if (tenant.verificationStatus !== TenantVerificationStatus.VERIFIED)
      return 'Your church needs to be verified before it can add branches.';
    if (!admin.isOwner) return 'Only owners can add branches.';
    return null;
  }

  private async freeAddress(
    rootSubdomain: string,
    label: string,
  ): Promise<string> {
    const base = branchAddress(rootSubdomain, label);
    if (base === rootSubdomain)
      throw new BadRequestException(
        'Give the branch a short label, like "Ikeja".',
      );
    for (let i = 1; i <= MAX_ADDRESS_TRIES; i++) {
      const candidate = i === 1 ? base : `${base}-${i}`;
      const check = await this.provisioning.checkSubdomain(candidate, {
        allowHyphen: true,
      });
      if (check.available) return candidate;
    }
    throw new ConflictException(
      'Try a different label; that address is taken.',
    );
  }

  private async sponsorablePlan(tenantId: string): Promise<string | undefined> {
    const sub = await this.subscriptionRepo.findOne({
      where: { tenantId },
      select: { id: true, planId: true },
    });
    return sub && !isFreePlan(sub.planId) ? sub.planId : undefined;
  }

  private async assertAvailable(): Promise<void> {
    if (!(await this.isAvailable()))
      throw new NotFoundException('Church networks aren’t available yet.');
  }

  private async maxLevels(): Promise<number> {
    return this.settings.getNumber(PlatformSettingKey.NETWORK_MAX_LEVELS);
  }

  private async currentTenant(): Promise<Tenant> {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) throw new ForbiddenException();
    return this.tenantRepo.findOneByOrFail({ id: tenantId });
  }

  // One indexed read of the whole network; walking it happens in memory.
  async loadTree(rootId: string): Promise<Tree> {
    const rows = await this.tenantRepo.find({
      where: { networkRootId: rootId },
      select: {
        id: true,
        name: true,
        subdomain: true,
        parentTenantId: true,
        networkLabel: true,
        networkRootId: true,
        isActive: true,
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const children = new Map<string, string[]>();
    for (const r of rows) {
      if (r.id === rootId || !r.parentTenantId) continue;
      children.set(r.parentTenantId, [
        ...(children.get(r.parentTenantId) ?? []),
        r.id,
      ]);
    }
    for (const list of children.values())
      list.sort((a, b) => byId.get(a)!.name.localeCompare(byId.get(b)!.name));
    return { rootId, byId, children };
  }

  private ancestorIds(tree: Tree, id: string): string[] {
    const out: string[] = [];
    let at = tree.byId.get(id)?.parentTenantId;
    while (at && tree.byId.has(at) && !out.includes(at)) {
      out.push(at);
      if (at === tree.rootId) break;
      at = tree.byId.get(at)!.parentTenantId;
    }
    return out;
  }

  // The church itself, then everything under it, depth first.
  subtreeIds(tree: Tree, id: string): string[] {
    const out: string[] = [];
    const walk = (at: string) => {
      out.push(at);
      for (const c of tree.children.get(at) ?? []) walk(c);
    };
    walk(id);
    return out;
  }

  private depthOf(tree: Tree, id: string): number {
    return id === tree.rootId ? 1 : this.ancestorIds(tree, id).length + 1;
  }

  // Levels a church and its branches take up: 1 when it has none.
  private heightOf(tree: Tree, id: string): number {
    const kids = tree.children.get(id) ?? [];
    return (
      1 +
      (kids.length ? Math.max(...kids.map((k) => this.heightOf(tree, k))) : 0)
    );
  }

  private toNode(
    tree: Tree,
    id: string,
    levels: Map<number, string>,
  ): NetworkNode {
    const row = tree.byId.get(id)!;
    const chain = [...this.ancestorIds(tree, id).reverse(), id];
    const depth = chain.length;
    return {
      id: row.id,
      name: row.name,
      subdomain: row.subdomain,
      label: row.networkLabel ?? row.name,
      parentId: id === tree.rootId ? null : row.parentTenantId,
      depth,
      // A network's own name for the level, or Region/Branch by whether it has branches of its own.
      levelName:
        depth === 1
          ? null
          : (levels.get(depth) ??
            (tree.children.get(id)?.length ? 'Region' : 'Branch')),
      path: chain
        .map((c) => {
          const t = tree.byId.get(c)!;
          return c === tree.rootId ? t.name : (t.networkLabel ?? t.name);
        })
        .join(' · '),
      childCount: tree.children.get(id)?.length ?? 0,
      isActive: row.isActive,
    };
  }

  private async nodeFor(tree: Tree, id: string): Promise<NetworkNode> {
    return this.toNode(tree, id, await this.levelNames(tree.rootId));
  }

  // The network's names for each level below the top, blank where it hasn't named one.
  private levelList(levels: Map<number, string>, maxLevels: number): string[] {
    return Array.from(
      { length: maxLevels - 1 },
      (_, i) => levels.get(i + 2) ?? '',
    );
  }

  private async levelNames(rootId: string): Promise<Map<number, string>> {
    const rows = await this.levelRepo.find({
      where: { networkRootId: rootId },
    });
    return new Map(rows.map((r) => [r.depth, r.name]));
  }
}
