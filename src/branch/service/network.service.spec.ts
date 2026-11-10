import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { NetworkService, branchAddress } from './network.service';
import { TenantVerificationStatus } from '../../tenant/enum/tenant-verification-status.enum';
import { OrganisationTypeEnum } from '../../tenant/enum/organisation-type.enum';

type Row = {
  id: string;
  name: string;
  subdomain: string;
  parentTenantId: string | null;
  networkRootId: string | null;
  networkLabel: string | null;
  isActive?: boolean;
  orgType?: OrganisationTypeEnum;
  verificationStatus?: TenantVerificationStatus;
  verifiedAt?: Date | null;
  themePreset?: string;
};

const church = (over: Partial<Row>): Row => ({
  id: 'x',
  name: 'X',
  subdomain: 'x',
  parentTenantId: null,
  networkRootId: null,
  networkLabel: null,
  isActive: true,
  orgType: OrganisationTypeEnum.CHURCH,
  verificationStatus: TenantVerificationStatus.VERIFIED,
  verifiedAt: new Date('2026-01-01'),
  themePreset: 'forest',
  ...over,
});

// ABC → Lagos → Ikeja, and ABC → Abuja
const network = (): Row[] => [
  church({ id: 'abc', name: 'ABC', subdomain: 'abc', networkRootId: 'abc' }),
  church({
    id: 'lagos',
    name: 'ABC Lagos',
    subdomain: 'abc-lagos',
    parentTenantId: 'abc',
    networkRootId: 'abc',
    networkLabel: 'Lagos',
  }),
  church({
    id: 'ikeja',
    name: 'ABC Ikeja',
    subdomain: 'abc-ikeja',
    parentTenantId: 'lagos',
    networkRootId: 'abc',
    networkLabel: 'Ikeja',
  }),
  church({
    id: 'abuja',
    name: 'ABC Abuja',
    subdomain: 'abc-abuja',
    parentTenantId: 'abc',
    networkRootId: 'abc',
    networkLabel: 'Abuja',
  }),
];

describe('NetworkService', () => {
  let rows: Row[];
  let current: string;
  const owner = { id: 'admin-1', isOwner: true } as never;
  const notOwner = { id: 'admin-2', isOwner: false } as never;

  const tenantRepo = {
    findOne: jest.fn(
      async ({ where }: { where: { id: string } }) =>
        rows.find((r) => r.id === where.id) ?? null,
    ),
    find: jest.fn(async ({ where }: { where: { networkRootId: string } }) =>
      rows.filter((r) => r.networkRootId === where.networkRootId),
    ),
    findOneByOrFail: jest.fn(async ({ id }: { id: string }) => {
      const r = rows.find((t) => t.id === id);
      if (!r) throw new Error('missing');
      return r;
    }),
    update: jest.fn(async (id: string, patch: Partial<Row>) => {
      const r = rows.find((t) => t.id === id);
      if (r) Object.assign(r, patch);
    }),
  };
  const levelRepo = {
    find: jest.fn().mockResolvedValue([]),
    delete: jest.fn(),
    save: jest.fn(),
  };
  const moveRepo = {
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((v) => v),
    save: jest.fn(),
  };
  const rollupRepo = {
    find: jest
      .fn()
      .mockResolvedValue([{ tenantId: 'lagos', memberCount: 120 }]),
  };
  const subscriptionRepo = {
    findOne: jest.fn().mockResolvedValue({ planId: 'pro' }),
  };
  const provisioning = {
    checkSubdomain: jest.fn(async (s: string) => ({
      available: !rows.some((r) => r.subdomain === s),
    })),
    provision: jest.fn(
      async (p: {
        subdomain: string;
        churchName: string;
        parentTenantId: string;
      }) => {
        const r = church({
          id: `new-${p.subdomain}`,
          name: p.churchName,
          subdomain: p.subdomain,
          parentTenantId: p.parentTenantId,
          verificationStatus: TenantVerificationStatus.NONE,
        });
        rows.push(r);
        return r;
      },
    ),
    recordEvent: jest.fn(),
  };
  const accounts = { readModeOn: jest.fn().mockResolvedValue(true) };
  const settings = { getNumber: jest.fn().mockResolvedValue(5) };
  const auditLog = { log: jest.fn() };
  const cache = {
    getGlobal: jest.fn().mockResolvedValue(undefined),
    setGlobal: jest.fn(),
    delGlobal: jest.fn(),
  };
  const cls = { get: jest.fn(() => current) };
  const service = new NetworkService(
    tenantRepo as never,
    levelRepo as never,
    moveRepo as never,
    subscriptionRepo as never,
    rollupRepo as never,
    provisioning as never,
    accounts as never,
    settings as never,
    auditLog as never,
    cache as never,
    cls as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    rows = network();
    current = 'abc';
    accounts.readModeOn.mockResolvedValue(true);
    settings.getNumber.mockResolvedValue(5);
  });

  it('makes a branch address from the network address and the label only', () => {
    expect(branchAddress('abc', 'Lagos Island')).toBe('abc-lagos-island');
    expect(branchAddress('abc', '  Ikeja ')).toBe('abc-ikeja');
  });

  describe('view', () => {
    it('shows nothing while the switch is off', async () => {
      accounts.readModeOn.mockResolvedValue(false);
      const v = await service.view(owner);
      expect(v.available).toBe(false);
      expect(v.nodes).toEqual([]);
    });

    it('lets a verified standalone church start a network, and says why an unverified one cannot', async () => {
      rows = [church({ id: 'solo', subdomain: 'solo' })];
      current = 'solo';
      expect((await service.view(owner)).canAddBranch).toBe(true);
      rows[0].verificationStatus = TenantVerificationStatus.PENDING;
      expect((await service.view(owner)).reasonCannotAdd).toMatch(/verified/);
    });

    it('shows a region its own branches and its chain upward, never the rest of the network', async () => {
      current = 'lagos';
      const v = await service.view(owner);
      expect(v.ancestors.map((n) => n.id)).toEqual(['abc']);
      expect(v.nodes.map((n) => n.id)).toEqual(['lagos', 'ikeja']);
      expect(v.me).toEqual(
        expect.objectContaining({
          depth: 2,
          levelName: 'Region',
          path: 'ABC · Lagos',
        }),
      );
      expect(v.nodes[1]).toEqual(
        expect.objectContaining({
          depth: 3,
          levelName: 'Branch',
          path: 'ABC · Lagos · Ikeja',
        }),
      );
    });
  });

  describe('addBranch', () => {
    const dto = {
      name: 'ABC Lekki',
      label: 'Lekki',
      ownerFirstname: 'Ada',
      ownerLastname: 'Obi',
      ownerEmail: 'Ada@Example.com',
    };

    it('starts a network, creates the branch at a generated address and copies the network’s standing', async () => {
      rows = [church({ id: 'abc', name: 'ABC', subdomain: 'abc' })];
      const node = await service.addBranch(owner, { ...dto, sponsor: true });

      expect(rows.find((r) => r.id === 'abc')!.networkRootId).toBe('abc');
      expect(provisioning.provision).toHaveBeenCalledWith(
        expect.objectContaining({
          subdomain: 'abc-lekki',
          parentTenantId: 'abc',
          adminEmail: 'ada@example.com',
          sponsoredPlanId: 'pro',
        }),
      );
      expect(provisioning.provision.mock.calls[0][0]).not.toHaveProperty(
        'adminPasswordHash',
      );
      expect(rows.find((r) => r.id === 'new-abc-lekki')).toEqual(
        expect.objectContaining({
          networkRootId: 'abc',
          networkLabel: 'Lekki',
          verificationStatus: TenantVerificationStatus.VERIFIED,
          themePreset: 'forest',
        }),
      );
      expect(node.path).toBe('ABC · Lekki');
    });

    it('adds -2 when the address is taken', async () => {
      current = 'lagos';
      await service.addBranch(owner, { ...dto, label: 'Ikeja' });
      expect(provisioning.provision).toHaveBeenCalledWith(
        expect.objectContaining({
          subdomain: 'abc-ikeja-2',
          parentTenantId: 'lagos',
        }),
      );
    });

    it('refuses past the level cap, for non-owners, and while the switch is off', async () => {
      settings.getNumber.mockResolvedValue(3);
      current = 'ikeja';
      await expect(service.addBranch(owner, dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      current = 'abc';
      await expect(service.addBranch(notOwner, dto)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      accounts.readModeOn.mockResolvedValue(false);
      await expect(service.addBranch(owner, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(provisioning.provision).not.toHaveBeenCalled();
    });
  });

  describe('moveChurch', () => {
    it('moves a church with its branches and logs it, keeping its address', async () => {
      const node = await service.moveChurch(
        owner,
        'ikeja',
        'abuja',
        'member-1',
      );
      expect(rows.find((r) => r.id === 'ikeja')).toEqual(
        expect.objectContaining({
          parentTenantId: 'abuja',
          subdomain: 'abc-ikeja',
        }),
      );
      expect(moveRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'ikeja',
          fromParentId: 'lagos',
          toParentId: 'abuja',
          movedByMemberId: 'member-1',
        }),
      );
      expect(node.path).toBe('ABC · Abuja · Ikeja');
    });

    it('refuses a loop, the top church, and going past the level cap', async () => {
      await expect(
        service.moveChurch(owner, 'lagos', 'ikeja', 'm'),
      ).rejects.toThrow(/own branches/);
      await expect(
        service.moveChurch(owner, 'abc', 'lagos', 'm'),
      ).rejects.toThrow(/top church/);
      settings.getNumber.mockResolvedValue(3);
      await expect(
        service.moveChurch(owner, 'lagos', 'abuja', 'm'),
      ).rejects.toThrow(/levels/);
      expect(moveRepo.save).not.toHaveBeenCalled();
    });

    it('lets a region move only within its own branches', async () => {
      current = 'lagos';
      await expect(
        service.moveChurch(owner, 'ikeja', 'abuja', 'm'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('publicNetwork', () => {
    it("lists the network's churches for the app's picker, from any church in it, and caches it", async () => {
      current = 'ikeja';
      const { network } = await service.publicNetwork();
      expect(network?.root).toEqual(
        expect.objectContaining({ tenantId: 'abc', subdomain: 'abc' }),
      );
      expect(network?.churches.map((c) => c.path)).toEqual([
        'ABC',
        'ABC · Abuja',
        'ABC · Lagos',
        'ABC · Lagos · Ikeja',
      ]);
      expect(cache.setGlobal).toHaveBeenCalledWith(
        'network-public:abc',
        network,
        300,
      );
    });

    it('is empty outside a network or with the switch off', async () => {
      rows = [church({ id: 'solo' })];
      current = 'solo';
      await expect(service.publicNetwork()).resolves.toEqual({ network: null });
      accounts.readModeOn.mockResolvedValue(false);
      await expect(service.publicNetwork()).resolves.toEqual({ network: null });
    });

    it('is cleared when a church moves', async () => {
      await service.moveChurch(owner, 'ikeja', 'abuja', 'm');
      expect(cache.delGlobal).toHaveBeenCalledWith('network-public:abc');
    });
  });

  it('shows the console the whole tree with member counts, from any network', async () => {
    const detail = await service.platformNetwork('abc');
    expect(detail.nodes.map((n) => n.path)).toEqual([
      'ABC',
      'ABC · Abuja',
      'ABC · Lagos',
      'ABC · Lagos · Ikeja',
    ]);
    expect(detail.nodes.find((n) => n.id === 'lagos')?.memberCount).toBe(120);
    await expect(service.platformNetwork('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lets only owners of the top church name the levels', async () => {
    current = 'lagos';
    await expect(service.setLevels(owner, ['Zone'])).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    current = 'abc';
    await service.setLevels(owner, [' Zone ', 'Parish']);
    expect(levelRepo.save).toHaveBeenCalledWith([
      { networkRootId: 'abc', depth: 2, name: 'Zone' },
      { networkRootId: 'abc', depth: 3, name: 'Parish' },
    ]);
  });
});
