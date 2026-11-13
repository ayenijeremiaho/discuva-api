import { NetworkShareService } from '../../network-share/network-share.service';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AccountSignInService } from './account-sign-in.service';
import { AuthService } from './auth.service';
import { DiscuvaAccountService } from '../../discuva-account/service/discuva-account.service';
import { DiscuvaAccountCodeService } from '../../discuva-account/service/discuva-account-code.service';
import { DiscuvaProfileService } from '../../discuva-account/service/discuva-profile.service';
import { profilesOffMock } from '../../discuva-account/testing/profiles-off.mock';
import { AccountDeletionService } from '../../discuva-account/service/account-deletion.service';
import { MemberService } from '../../member/service/member.service';
import { CacheService } from '../../utility/service/cache.service';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { DiscuvaAccountCodePurpose } from '../../discuva-account/entity/discuva-account-code.entity';

const store = new Map<string, unknown>();
const cache = {
  setGlobal: jest.fn(async (k: string, v: unknown) => void store.set(k, v)),
  getGlobal: jest.fn(async (k: string) => store.get(k)),
  delGlobal: jest.fn(async (k: string) => Number(store.delete(k))),
};
const codes = {
  sendCode: jest.fn().mockResolvedValue(undefined),
  verifyCode: jest.fn().mockResolvedValue(undefined),
};
const networkShare = { networkRootOf: jest.fn().mockResolvedValue(null) };
const accounts = {
  homeIn: jest.fn(),
  isOn: jest.fn(),
  isProfileOn: jest.fn().mockResolvedValue(false),
  isNetworkOn: jest.fn().mockResolvedValue(false),
  linkHere: jest.fn(),
  recordConsent: jest.fn(),
  accountFor: jest.fn(),
  findByEmail: jest.fn(),
  findById: jest.fn(),
  basicsFrom: jest.fn(),
  create: jest.fn(),
  link: jest.fn(),
  linksOf: jest.fn(),
  endSessionsEverywhere: jest.fn(),
  setDeviceOnAccount: jest.fn(),
  isEligible: jest.fn().mockReturnValue(true),
  remove: jest.fn(),
  needsDeviceConfirmation: jest.fn().mockResolvedValue(false),
  registerDevice: jest.fn(),
};
const memberService = {
  findByEmail: jest.fn(),
  createForAccount: jest.fn(),
  getById: jest.fn(),
  getByIdWithCredentials: jest.fn(),
  applyAccountCredentials: jest.fn(),
};
const authService = {
  startMemberSession: jest.fn().mockResolvedValue({ access_token: 'tok' }),
  validateMember: jest.fn().mockResolvedValue({ id: 'm2' }),
  login: jest.fn().mockResolvedValue({ access_token: 'tok' }),
};
const utility = {
  resolveChurchName: jest.fn().mockResolvedValue('the church'),
  sendEmailWithTemplate: jest.fn(),
};
const audit = { log: jest.fn() };
const settings = { getNumber: jest.fn().mockResolvedValue(10) };
const ctx: Record<string, unknown> = {};
const cls = { get: jest.fn((k: string) => ctx[k]) };
const tenantRepo = { find: jest.fn(), findOne: jest.fn() };

const account = {
  id: 'a1',
  email: 'ada@example.com',
  password: 'acct-hash',
  deviceId: 'phone-123',
  frozenAt: null,
};

const profiles = profilesOffMock();
const deletion = { scheduledFor: jest.fn().mockResolvedValue(null) };

describe('AccountSignInService', () => {
  let service: AccountSignInService;

  beforeEach(async () => {
    jest.clearAllMocks();
    store.clear();
    ctx.tenantId = 't2';
    accounts.isOn.mockResolvedValue(true);
    const module = await Test.createTestingModule({
      providers: [
        AccountSignInService,
        { provide: DiscuvaAccountService, useValue: accounts },
        { provide: DiscuvaProfileService, useValue: profiles },
        { provide: AccountDeletionService, useValue: deletion },
        { provide: DiscuvaAccountCodeService, useValue: codes },
        { provide: MemberService, useValue: memberService },
        { provide: AuthService, useValue: authService },
        { provide: CacheService, useValue: cache },
        { provide: UtilityService, useValue: utility },
        { provide: AuditLogService, useValue: audit },
        { provide: PlatformSettingsService, useValue: settings },
        { provide: ClsService, useValue: cls },
        { provide: getRepositoryToken(Tenant), useValue: tenantRepo },
        { provide: NetworkShareService, useValue: networkShare },
      ],
    }).compile();
    service = module.get(AccountSignInService);
  });

  it('is unavailable while the switch is off', async () => {
    accounts.isOn.mockResolvedValue(false);
    await expect(service.startJoin('a@b.co', 'phone-123')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('tells the apps which of the two switches are on for this church', async () => {
    accounts.isOn.mockResolvedValue(true);
    accounts.isProfileOn.mockResolvedValue(false);
    await expect(service.available()).resolves.toEqual({
      available: true,
      profile: false,
      network: false,
      inNetwork: false,
    });
  });

  it('says whether church networks are on here, and whether this church is in one', async () => {
    accounts.isOn.mockResolvedValue(true);
    accounts.isNetworkOn.mockResolvedValueOnce(true);
    networkShare.networkRootOf.mockResolvedValueOnce('root-1');
    await expect(service.available()).resolves.toEqual(
      expect.objectContaining({ network: true, inNetwork: true }),
    );
  });

  describe('joining a church', () => {
    it('sends the same code email whether or not an account exists', async () => {
      accounts.findByEmail.mockResolvedValueOnce(null);
      await service.startJoin('new@b.co', 'phone-123');
      accounts.findByEmail.mockResolvedValueOnce(account);
      accounts.basicsFrom.mockResolvedValueOnce({ firstname: 'ada' });
      await service.startJoin('ada@example.com', 'phone-123');
      expect(codes.sendCode).toHaveBeenCalledTimes(2);
      const [first, second] = codes.sendCode.mock.calls;
      expect(first.slice(1, 3)).toEqual([
        DiscuvaAccountCodePurpose.JOIN,
        'phone-123',
      ]);
      expect(first[3].action).toBe(second[3].action);
      expect(first[0]).toBe('new@b.co');
    });

    it('tells someone already in this church to sign in instead', async () => {
      memberService.findByEmail.mockResolvedValue({
        status: MemberStatusEnum.ACTIVE,
      });
      await expect(
        service.verifyJoin('ada@example.com', '123456', 'phone-123'),
      ).resolves.toEqual({
        status: 'ALREADY_MEMBER',
      });
      expect(cache.setGlobal).not.toHaveBeenCalled();
    });

    it('welcomes back an existing account by first name', async () => {
      memberService.findByEmail.mockResolvedValue(null);
      accounts.findByEmail.mockResolvedValue(account);
      accounts.basicsFrom.mockResolvedValue({ firstname: 'Ada' });
      const result = await service.verifyJoin(
        'ada@example.com',
        '123456',
        'phone-123',
      );
      expect(result).toMatchObject({
        status: 'EXISTING_ACCOUNT',
        firstName: 'Ada',
      });
    });

    it('joins with an existing account: its basics, password and device, then signs in', async () => {
      memberService.findByEmail.mockResolvedValue(null);
      accounts.findByEmail.mockResolvedValue(account);
      accounts.findById.mockResolvedValue(account);
      accounts.basicsFrom.mockResolvedValue({
        firstname: 'Ada',
        lastname: 'Obi',
        phoneNumber: '+234800',
      });
      const { joinToken } = (await service.verifyJoin(
        'ada@example.com',
        '123456',
        'phone-123',
      )) as { joinToken: string };
      memberService.createForAccount.mockResolvedValue({ id: 'm2' });
      memberService.getById.mockResolvedValue({ id: 'm2' });

      await service.completeJoin({
        joinToken,
        deviceId: 'phone-123',
        firstname: 'Someone',
        lastname: 'Else',
      } as never);

      expect(memberService.createForAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          firstname: 'Ada',
          lastname: 'Obi',
          phoneNumber: '+234800',
          email: 'ada@example.com',
        }),
        account,
        'phone-123',
      );
      expect(accounts.link).toHaveBeenCalledWith('a1', 'm2', false);
      expect(authService.startMemberSession).toHaveBeenCalled();
      expect(store.size).toBe(0);
    });

    it('joins from any phone, since the join code already proved the email, and registers it here', async () => {
      memberService.findByEmail.mockResolvedValue(null);
      accounts.findByEmail.mockResolvedValue(account);
      accounts.findById.mockResolvedValue(account);
      accounts.basicsFrom.mockResolvedValue({
        firstname: 'Ada',
        lastname: 'Obi',
      });
      const { joinToken } = (await service.verifyJoin(
        'ada@example.com',
        '123456',
        'church-c-app',
      )) as { joinToken: string };
      memberService.createForAccount.mockResolvedValue({ id: 'm3' });
      memberService.getById.mockResolvedValue({ id: 'm3' });
      await service.completeJoin({
        joinToken,
        deviceId: 'church-c-app',
      } as never);
      expect(memberService.createForAccount).toHaveBeenCalledWith(
        expect.anything(),
        account,
        'church-c-app',
      );
    });

    it('refuses to join with a frozen account', async () => {
      memberService.findByEmail.mockResolvedValue(null);
      accounts.findByEmail.mockResolvedValue({
        ...account,
        frozenAt: new Date(),
      });
      accounts.findById.mockResolvedValue({ ...account, frozenAt: new Date() });
      const { joinToken } = (await service.verifyJoin(
        'ada@example.com',
        '123456',
        'phone-123',
      )) as { joinToken: string };
      await expect(
        service.completeJoin({ joinToken, deviceId: 'phone-123' } as never),
      ).rejects.toThrow('frozen');
      expect(memberService.createForAccount).not.toHaveBeenCalled();
    });

    it('creates an account for someone new, with their own password', async () => {
      memberService.findByEmail.mockResolvedValue(null);
      accounts.findByEmail.mockResolvedValue(null);
      const { joinToken } = (await service.verifyJoin(
        'new@b.co',
        '123456',
        'phone-123',
      )) as { joinToken: string };
      jest.spyOn(UtilityService, 'hashValue').mockResolvedValue('new-hash');
      accounts.create.mockResolvedValue({ id: 'a9' });
      accounts.findById.mockResolvedValue({
        id: 'a9',
        password: 'new-hash',
        deviceId: 'phone-123',
      });
      memberService.createForAccount.mockResolvedValue({ id: 'm9' });
      memberService.getById.mockResolvedValue({ id: 'm9' });

      await service.completeJoin({
        joinToken,
        deviceId: 'phone-123',
        firstname: 'Bayo',
        lastname: 'Ade',
        password: 'Str0ng!pass',
      } as never);

      expect(accounts.create).toHaveBeenCalledWith(
        'new@b.co',
        'new-hash',
        'phone-123',
      );
      expect(accounts.link).toHaveBeenCalledWith('a9', 'm9', false);
    });

    it('asks for a name when the account has no church left to bring it from', async () => {
      memberService.findByEmail.mockResolvedValue(null);
      accounts.findByEmail.mockResolvedValue(account);
      accounts.findById.mockResolvedValue(account);
      accounts.basicsFrom.mockResolvedValue(null);
      const verified = (await service.verifyJoin(
        'ada@example.com',
        '123456',
        'phone-123',
      )) as {
        joinToken: string;
        needsName: boolean;
      };
      expect(verified.needsName).toBe(true);
      await expect(
        service.completeJoin({
          joinToken: verified.joinToken,
          deviceId: 'phone-123',
        } as never),
      ).rejects.toThrow('first and last name');
      memberService.createForAccount.mockResolvedValue({ id: 'm3' });
      memberService.getById.mockResolvedValue({ id: 'm3' });
      await service.completeJoin({
        joinToken: verified.joinToken,
        deviceId: 'phone-123',
        firstname: 'Ada',
        lastname: 'Obi',
      } as never);
      expect(memberService.createForAccount).toHaveBeenCalledWith(
        expect.objectContaining({ firstname: 'Ada', lastname: 'Obi' }),
        account,
        'phone-123',
      );
    });

    it("removes a brand-new account if joining the church then fails, so the email isn't stuck", async () => {
      memberService.findByEmail.mockResolvedValue(null);
      accounts.findByEmail.mockResolvedValue(null);
      const { joinToken } = (await service.verifyJoin(
        'new@b.co',
        '123456',
        'phone-123',
      )) as { joinToken: string };
      jest.spyOn(UtilityService, 'hashValue').mockResolvedValue('h');
      accounts.create.mockResolvedValue({ id: 'a9' });
      accounts.findById.mockResolvedValue({ id: 'a9' });
      memberService.createForAccount.mockRejectedValueOnce(
        new Error('member limit reached'),
      );
      await expect(
        service.completeJoin({
          joinToken,
          deviceId: 'phone-123',
          firstname: 'B',
          lastname: 'A',
          password: 'Str0ng!pass',
        } as never),
      ).rejects.toThrow('member limit reached');
      expect(accounts.remove).toHaveBeenCalledWith('a9');
    });

    it('keeps an existing account when joining fails', async () => {
      memberService.findByEmail.mockResolvedValue(null);
      accounts.findByEmail.mockResolvedValue(account);
      accounts.findById.mockResolvedValue(account);
      accounts.basicsFrom.mockResolvedValue({
        firstname: 'Ada',
        lastname: 'Obi',
      });
      const { joinToken } = (await service.verifyJoin(
        'ada@example.com',
        '123456',
        'phone-123',
      )) as { joinToken: string };
      memberService.createForAccount.mockRejectedValueOnce(
        new Error('member limit reached'),
      );
      await expect(
        service.completeJoin({ joinToken, deviceId: 'phone-123' } as never),
      ).rejects.toThrow();
      expect(accounts.remove).not.toHaveBeenCalled();
    });

    it('sends under-18s to their church instead', async () => {
      memberService.findByEmail.mockResolvedValue(null);
      accounts.findByEmail.mockResolvedValue(null);
      accounts.isEligible.mockReturnValueOnce(false);
      const { joinToken } = (await service.verifyJoin(
        'kid@b.co',
        '123456',
        'phone-123',
      )) as { joinToken: string };
      await expect(
        service.completeJoin({
          joinToken,
          deviceId: 'phone-123',
          firstname: 'K',
          lastname: 'D',
          password: 'Str0ng!pass',
          birthYear: 2015,
        } as never),
      ).rejects.toThrow(ForbiddenException);
      expect(accounts.create).not.toHaveBeenCalled();
    });

    it("won't use a join step from another church or another phone", async () => {
      memberService.findByEmail.mockResolvedValue(null);
      accounts.findByEmail.mockResolvedValue(null);
      const { joinToken } = (await service.verifyJoin(
        'new@b.co',
        '123456',
        'phone-123',
      )) as { joinToken: string };
      await expect(
        service.completeJoin({ joinToken, deviceId: 'phone-999' } as never),
      ).rejects.toThrow(BadRequestException);
      ctx.tenantId = 't3';
      await expect(
        service.completeJoin({ joinToken, deviceId: 'phone-123' } as never),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('adding this church to an account', () => {
    const member = {
      id: 'm2',
      email: 'ada@example.com',
      firstname: 'ada',
      deviceId: 'phone-123',
      discuvaAccountId: null,
    };

    it('emails a code to the account email from the same phone', async () => {
      memberService.getByIdWithCredentials.mockResolvedValue(member);
      accounts.findByEmail.mockResolvedValue(account);
      await service.requestLink('m2');
      expect(codes.sendCode).toHaveBeenCalledWith(
        'ada@example.com',
        DiscuvaAccountCodePurpose.LINK,
        'phone-123',
        expect.objectContaining({ firstName: 'ada' }),
      );
    });

    it('links from this church app whatever phone the account uses elsewhere; the code proves the email', async () => {
      memberService.getByIdWithCredentials.mockResolvedValue({
        ...member,
        deviceId: 'church-b-app',
      });
      accounts.findByEmail.mockResolvedValue(account);
      await service.requestLink('m2');
      expect(codes.sendCode).toHaveBeenCalledWith(
        'ada@example.com',
        DiscuvaAccountCodePurpose.LINK,
        'church-b-app',
        expect.anything(),
      );
    });

    it("won't link twice", async () => {
      memberService.getByIdWithCredentials.mockResolvedValue({
        ...member,
        discuvaAccountId: 'a1',
      });
      await expect(service.requestLink('m2')).rejects.toThrow(
        ConflictException,
      );
    });

    it("links after the code and takes the account's password, keeping this church app's phone", async () => {
      memberService.getByIdWithCredentials.mockResolvedValue(member);
      accounts.findByEmail.mockResolvedValue(account);
      await service.confirmLink('m2', '123456');
      expect(codes.verifyCode).toHaveBeenCalled();
      expect(accounts.link).toHaveBeenCalledWith('a1', 'm2', false);
      expect(memberService.applyAccountCredentials).toHaveBeenCalledWith(
        'm2',
        account,
      );
    });

    it('does not link when the code is wrong', async () => {
      memberService.getByIdWithCredentials.mockResolvedValue(member);
      accounts.findByEmail.mockResolvedValue(account);
      codes.verifyCode.mockRejectedValueOnce(new BadRequestException());
      await expect(service.confirmLink('m2', '000000')).rejects.toThrow(
        BadRequestException,
      );
      expect(accounts.link).not.toHaveBeenCalled();
    });
  });

  describe('switching churches', () => {
    beforeEach(() => {
      memberService.getById.mockResolvedValue({
        id: 'm1',
        discuvaAccountId: 'a1',
      });
      accounts.findById.mockResolvedValue(account);
      accounts.linksOf.mockResolvedValue([
        { tenantId: 't2', memberId: 'm1' },
        { tenantId: 't5', memberId: 'm5' },
      ]);
    });

    it("finds the person's home branch in this church's network", async () => {
      tenantRepo.findOne
        .mockResolvedValueOnce({ id: ctx.tenantId, networkRootId: 'abc' })
        .mockResolvedValueOnce({ id: 't5', subdomain: 'abc-ikeja' });
      accounts.homeIn.mockResolvedValue('t5');
      await expect(service.networkHome('m1')).resolves.toEqual({
        networkRootId: 'abc',
        home: { tenantId: 't5', subdomain: 'abc-ikeja' },
      });
      expect(accounts.homeIn).toHaveBeenCalledWith(account.id, 'abc');
    });

    it('has no home outside a network', async () => {
      tenantRepo.findOne.mockResolvedValueOnce({
        id: ctx.tenantId,
        networkRootId: null,
      });
      await expect(service.networkHome('m1')).resolves.toEqual({
        networkRootId: null,
        home: null,
      });
    });

    it('refuses a church the account is not linked to', async () => {
      await expect(service.switchChurch('m1', 't9')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('hands over to the other church once, on the same phone', async () => {
      tenantRepo.findOne.mockResolvedValue({ id: 't5', subdomain: 'other' });
      const { subdomain, token } = await service.switchChurch('m1', 't5');
      expect(subdomain).toBe('other');

      ctx.tenantId = 't5';
      memberService.getByIdWithCredentials.mockResolvedValue({
        id: 'm5',
        discuvaAccountId: 'a1',
        deviceId: 'phone-123',
      });
      await expect(service.redeemHandoff(token, 'phone-123')).resolves.toEqual({
        access_token: 'tok',
      });
      await expect(service.redeemHandoff(token, 'phone-123')).rejects.toThrow(
        BadRequestException,
      );
    });

    it("won't hand over to another phone or the wrong church", async () => {
      tenantRepo.findOne.mockResolvedValue({ id: 't5', subdomain: 'other' });
      memberService.getByIdWithCredentials.mockResolvedValue({
        id: 'm5',
        discuvaAccountId: 'a1',
        deviceId: 'phone-123',
      });
      const first = await service.switchChurch('m1', 't5');
      ctx.tenantId = 't5';
      await expect(
        service.redeemHandoff(first.token, 'stranger-phone'),
      ).rejects.toThrow(ForbiddenException);
      ctx.tenantId = 't2';
      const second = await service.switchChurch('m1', 't5');
      await expect(
        service.redeemHandoff(second.token, 'phone-123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('a church app that has no phone yet asks to confirm by signing in, unless the phone is already known', async () => {
      tenantRepo.findOne.mockResolvedValue({ id: 't5', subdomain: 'other' });
      memberService.getByIdWithCredentials.mockResolvedValue({
        id: 'm5',
        discuvaAccountId: 'a1',
        deviceId: null,
      });
      accounts.needsDeviceConfirmation.mockResolvedValueOnce(true);
      let { token } = await service.switchChurch('m1', 't5');
      ctx.tenantId = 't5';
      await expect(
        service.redeemHandoff(token, 'church-b-app'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'DEVICE_CONFIRMATION_REQUIRED',
        }),
      });
      expect(accounts.registerDevice).not.toHaveBeenCalled();

      ctx.tenantId = 't2';
      ({ token } = await service.switchChurch('m1', 't5'));
      ctx.tenantId = 't5';
      await service.redeemHandoff(token, 'shared-phone-id');
      expect(accounts.registerDevice).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'm5' }),
        'shared-phone-id',
      );
    });
  });

  describe('confirming a new phone for a church app', () => {
    const member = {
      id: 'm2',
      email: 'ada@example.com',
      firstname: 'ada',
      role: 'MEMBER',
      changedPassword: true,
      discuvaAccountId: 'a1',
      deviceId: null,
    };

    beforeEach(() =>
      memberService.getByIdWithCredentials.mockResolvedValue(member),
    );

    it('needs the password before any code is sent', async () => {
      authService.validateMember.mockRejectedValueOnce(
        new Error('Invalid email or password'),
      );
      await expect(
        service.requestDeviceConfirmation(
          'ada@example.com',
          'wrong',
          'church-b-app',
        ),
      ).rejects.toThrow('Invalid');
      expect(codes.sendCode).not.toHaveBeenCalled();
    });

    it('emails a code only when this phone needs confirming', async () => {
      await expect(
        service.requestDeviceConfirmation(
          'ada@example.com',
          'pw',
          'church-b-app',
        ),
      ).rejects.toThrow('ready');
      accounts.needsDeviceConfirmation.mockResolvedValueOnce(true);
      await service.requestDeviceConfirmation(
        'ada@example.com',
        'pw',
        'church-b-app',
      );
      expect(codes.sendCode).toHaveBeenCalledWith(
        'ada@example.com',
        DiscuvaAccountCodePurpose.CONFIRM_DEVICE,
        'church-b-app',
        expect.anything(),
      );
    });

    it('registers the phone after the right code and signs in', async () => {
      accounts.needsDeviceConfirmation.mockResolvedValueOnce(true);
      await expect(
        service.confirmDevice(
          'ada@example.com',
          'pw',
          'church-b-app',
          '123456',
        ),
      ).resolves.toEqual({ access_token: 'tok' });
      expect(codes.verifyCode).toHaveBeenCalledWith(
        'ada@example.com',
        DiscuvaAccountCodePurpose.CONFIRM_DEVICE,
        'church-b-app',
        '123456',
      );
      expect(accounts.registerDevice).toHaveBeenCalledWith(
        member,
        'church-b-app',
      );
      expect(authService.login).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'm2' }),
        'church-b-app',
      );
    });

    it('registers nothing when the code is wrong', async () => {
      accounts.needsDeviceConfirmation.mockResolvedValueOnce(true);
      codes.verifyCode.mockRejectedValueOnce(new BadRequestException());
      await expect(
        service.confirmDevice(
          'ada@example.com',
          'pw',
          'church-b-app',
          '000000',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(accounts.registerDevice).not.toHaveBeenCalled();
      expect(authService.login).not.toHaveBeenCalled();
    });
  });

  describe('account status', () => {
    it('offers linking to someone not moved whose email has an account', async () => {
      memberService.getById.mockResolvedValue({
        id: 'm2',
        email: 'ada@example.com',
        discuvaAccountId: null,
      });
      accounts.findByEmail.mockResolvedValue(account);
      await expect(service.status('m2')).resolves.toEqual({
        enabled: true,
        moved: false,
        linkAvailable: true,
        email: 'ada@example.com',
        profile: false,
        needsConsent: false,
        detailsToConfirm: [],
        deletesOn: null,
      });
    });

    it('shows nothing while the switch is off', async () => {
      accounts.isOn.mockResolvedValue(false);
      memberService.getById.mockResolvedValue({
        id: 'm2',
        email: 'ada@example.com',
        discuvaAccountId: 'a1',
      });
      await expect(service.status('m2')).resolves.toMatchObject({
        enabled: false,
        moved: false,
        linkAvailable: false,
      });
    });

    it('signs out at every church', async () => {
      const member = { id: 'm1', discuvaAccountId: 'a1' };
      memberService.getById.mockResolvedValue(member);
      await service.signOutEverywhere('m1');
      expect(accounts.endSessionsEverywhere).toHaveBeenCalledWith(member);
    });
  });

  describe('with Global Profile on', () => {
    const holder = {
      id: 'm2',
      email: 'ada@example.com',
      discuvaAccountId: 'a1',
    };
    beforeEach(() => {
      accounts.isOn.mockResolvedValue(true);
      accounts.isProfileOn.mockResolvedValue(true);
      profiles.ownerOf.mockResolvedValue('a1');
    });
    afterEach(() => {
      accounts.isProfileOn.mockResolvedValue(false);
      profiles.ownerOf.mockResolvedValue(null);
      profiles.basicsFor.mockResolvedValue(null);
      profiles.reconcile.mockResolvedValue([]);
    });

    const ticketFor = async () => {
      memberService.findByEmail.mockResolvedValue(null);
      accounts.findByEmail.mockResolvedValue(account);
      accounts.findById.mockResolvedValue(account);
      return (
        (await service.verifyJoin(
          'ada@example.com',
          '123456',
          'phone-123',
        )) as { joinToken: string }
      ).joinToken;
    };

    it('asks the person to agree before joining shares their profile', async () => {
      const joinToken = await ticketFor();
      await expect(
        service.completeJoin({ joinToken, deviceId: 'phone-123' } as never),
      ).rejects.toThrow('Please agree to share your Discuva profile');
      expect(memberService.createForAccount).not.toHaveBeenCalled();
    });

    it('joins from the profile, records the agreement and lines the copies up', async () => {
      profiles.basicsFor.mockResolvedValue({
        firstname: 'Ada',
        lastname: 'Obi',
        address: '12 Example Street',
      });
      const joinToken = await ticketFor();
      memberService.createForAccount.mockResolvedValue({ id: 'm2' });
      memberService.getById.mockResolvedValue(holder);

      await service.completeJoin({
        joinToken,
        deviceId: 'phone-123',
        consent: true,
      } as never);

      expect(memberService.createForAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          firstname: 'Ada',
          address: '12 Example Street',
        }),
        account,
        'phone-123',
      );
      expect(accounts.basicsFrom).not.toHaveBeenCalled();
      expect(accounts.link).toHaveBeenCalledWith('a1', 'm2', true);
      expect(profiles.reconcile).toHaveBeenCalledWith(holder);
    });

    it('asks for agreement before adding this church, then lines the copies up', async () => {
      const member = {
        id: 'm2',
        email: 'ada@example.com',
        deviceId: 'phone-123',
        discuvaAccountId: null,
      };
      memberService.getByIdWithCredentials.mockResolvedValue(member);
      accounts.findByEmail.mockResolvedValue(account);

      await expect(service.confirmLink('m2', '123456')).rejects.toThrow(
        'Please agree',
      );
      expect(accounts.link).not.toHaveBeenCalled();

      await service.confirmLink('m2', '123456', true);
      expect(accounts.link).toHaveBeenCalledWith('a1', 'm2', true);
      expect(profiles.reconcile).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'm2', discuvaAccountId: 'a1' }),
      );
    });

    it('shows the one-time agreement and any details to choose between', async () => {
      const differs = [
        { field: 'phoneNumber', yours: '+234801', here: '+234802' },
      ];
      memberService.getById.mockResolvedValue(holder);
      accounts.linkHere.mockResolvedValue({ consentedAt: null });
      profiles.reconcile.mockResolvedValue(differs);

      await expect(service.status('m2')).resolves.toMatchObject({
        moved: true,
        profile: true,
        needsConsent: true,
        detailsToConfirm: differs,
      });

      accounts.linkHere.mockResolvedValue({ consentedAt: new Date() });
      await expect(service.status('m2')).resolves.toMatchObject({
        needsConsent: false,
      });
    });

    it('records agreement and the chosen details for this church', async () => {
      memberService.getById.mockResolvedValue(holder);
      await service.consent('m2');
      expect(accounts.recordConsent).toHaveBeenCalledWith('m2');

      await service.confirmDetails('m2', { phoneNumber: 'HERE' });
      expect(profiles.resolve).toHaveBeenCalledWith(holder, {
        phoneNumber: 'HERE',
      });
    });

    it('offers neither while Global Profile is off here', async () => {
      memberService.getById.mockResolvedValue(holder);
      profiles.ownerOf.mockResolvedValue(null);
      await expect(service.consent('m2')).rejects.toThrow(NotFoundException);
      await expect(
        service.confirmDetails('m2', { phoneNumber: 'HERE' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
