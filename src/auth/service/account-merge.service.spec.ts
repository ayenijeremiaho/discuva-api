import { Test } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AccountMergeService } from './account-merge.service';
import { DiscuvaAccountService } from '../../discuva-account/service/discuva-account.service';
import { DiscuvaAccountCodeService } from '../../discuva-account/service/discuva-account-code.service';
import { DiscuvaAccountCodePurpose } from '../../discuva-account/entity/discuva-account-code.entity';
import { MemberService } from '../../member/service/member.service';
import { AuditLogService } from '../../utility/service/audit-log.service';

const keep = { id: 'keep', email: 'ada@example.com', frozenAt: null };
const gone = { id: 'gone', email: 'ada.old@example.com', frozenAt: null };
const accounts = {
  isProfileOn: jest.fn(),
  accountFor: jest.fn(),
  findByEmail: jest.fn(),
  sharesChurch: jest.fn(),
  emailTakenAtChurchesOf: jest.fn(),
  mergeInto: jest.fn(),
};
const codes = { sendCode: jest.fn(), verifyCode: jest.fn() };
const memberService = {
  getByIdWithCredentials: jest.fn().mockResolvedValue({
    id: 'm1',
    firstname: 'Ada',
    deviceId: 'phone-1',
  }),
};
const audit = { log: jest.fn() };

describe('AccountMergeService', () => {
  let service: AccountMergeService;

  beforeEach(async () => {
    jest.clearAllMocks();
    accounts.isProfileOn.mockResolvedValue(true);
    accounts.accountFor.mockResolvedValue(keep);
    accounts.findByEmail.mockResolvedValue(gone);
    accounts.sharesChurch.mockResolvedValue(false);
    accounts.emailTakenAtChurchesOf.mockResolvedValue(false);
    const module = await Test.createTestingModule({
      providers: [
        AccountMergeService,
        { provide: DiscuvaAccountService, useValue: accounts },
        { provide: DiscuvaAccountCodeService, useValue: codes },
        { provide: MemberService, useValue: memberService },
        { provide: AuditLogService, useValue: audit },
      ],
    }).compile();
    service = module.get(AccountMergeService);
  });

  it('sends a code to both emails', async () => {
    await service.start('m1', gone.email);
    expect(
      codes.sendCode.mock.calls.map(([email, purpose, device]) => [
        email,
        purpose,
        device,
      ]),
    ).toEqual([
      [keep.email, DiscuvaAccountCodePurpose.MERGE, 'phone-1'],
      [gone.email, DiscuvaAccountCodePurpose.MERGE, 'phone-1'],
    ]);
  });

  it('combines them only after both codes check out', async () => {
    codes.verifyCode
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('wrong code'));
    await expect(
      service.confirm('m1', gone.email, '111111', '222222'),
    ).rejects.toThrow('wrong code');
    expect(accounts.mergeInto).not.toHaveBeenCalled();

    codes.verifyCode.mockResolvedValue(undefined);
    await service.confirm('m1', gone.email, '111111', '222222');
    expect(accounts.mergeInto).toHaveBeenCalledWith('keep', 'gone');
    expect(audit.log).toHaveBeenCalledWith(
      'ACCOUNT_MERGED',
      expect.objectContaining({ metadata: { mergedEmail: gone.email } }),
    );
  });

  it.each([
    [
      'Global Profile is off',
      () => accounts.isProfileOn.mockResolvedValue(false),
      NotFoundException,
    ],
    [
      'both are at one church',
      () => accounts.sharesChurch.mockResolvedValue(true),
      ConflictException,
    ],
    [
      "the kept email is someone else's at a church",
      () => accounts.emailTakenAtChurchesOf.mockResolvedValue(true),
      ConflictException,
    ],
    [
      'the other account is frozen',
      () =>
        accounts.findByEmail.mockResolvedValue({
          ...gone,
          frozenAt: new Date(),
        }),
      ForbiddenException,
    ],
  ])('refuses when %s', async (_label, arrange, error) => {
    arrange();
    await expect(service.start('m1', gone.email)).rejects.toThrow(error);
    expect(codes.sendCode).not.toHaveBeenCalled();
  });

  it("refuses an email that isn't another account", async () => {
    accounts.findByEmail.mockResolvedValue(keep);
    await expect(service.start('m1', keep.email)).rejects.toThrow(
      "isn't another Discuva account",
    );
  });
});
