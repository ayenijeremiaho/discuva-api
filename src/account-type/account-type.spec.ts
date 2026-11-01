import { renderInLayout } from '../notification-catalogue/email-catalogue';
import { BadRequestException } from '@nestjs/common';
import { OrganisationTypeEnum } from '../tenant/enum/organisation-type.enum';
import { KNOWN_MODULES } from '../church-settings/constants/known-modules.constant';
import { AccountTypeService } from './account-type.service';
import { AccountTypeAdminService } from './account-type-admin.service';
import { defaultAvailability } from './account-type.constant';
import {
  applyWording,
  applyWordingAround,
  applyWordingToHtml,
} from './apply-wording';

describe('applyWording', () => {
  const rules = [
    { from: 'Terms of Service', to: 'Terms of Service' },
    { from: 'Service Programme', to: 'Meeting Plan' },
    { from: 'Services', to: 'Meetings' },
    { from: 'Service', to: 'Meeting' },
    { from: 'Church', to: 'Organisation' },
    { from: 'Offering', to: 'Donation' },
    { from: 'First-timer', to: 'New contact' },
  ];

  it.each([
    ['Add a Service', 'Add a Meeting'],
    ['upcoming services', 'upcoming meetings'],
    ['SERVICE', 'MEETING'],
    ['Open the Service Programme', 'Open the Meeting Plan'],
    ['a church near you', 'an organisation near you'],
    ['A church', 'An organisation'],
    ['an offering', 'a donation'],
    ['a first-timer', 'a new contact'],
    ['Read our Terms of Service', 'Read our Terms of Service'],
    ['{{church_name}} welcomes you', '{{church_name}} welcomes you'],
    ['churchyard', 'churchyard'],
  ])('%s becomes %s', (text, expected) => {
    expect(applyWording(text, rules)).toBe(expected);
  });

  it('leaves text alone with no rules', () => {
    expect(applyWording('Your church', [])).toBe('Your church');
  });
});

describe('applyWordingToHtml', () => {
  const rules = [{ from: 'Service', to: 'Meeting' }];

  it('changes visible text only', () => {
    expect(
      applyWordingToHtml(
        '<style>.service{}</style><p class="service">Your service {{service}}</p>',
        rules,
      ),
    ).toBe(
      '<style>.service{}</style><p class="service">Your meeting {{service}}</p>',
    );
  });
});

describe('applyWordingAround', () => {
  const rules = [{ from: 'Church', to: 'Organisation' }];

  it('keeps names as written', () => {
    expect(
      applyWordingAround(
        'Grace Church: your church update',
        ['Grace Church'],
        rules,
      ),
    ).toBe('Grace Church: your organisation update');
  });
});

describe('email templates in an account type words', () => {
  it('words fixed template text and keeps the church name', () => {
    const rules = [
      { from: 'Service', to: 'Meeting' },
      { from: 'Church', to: 'Organisation' },
    ];
    const { html } = renderInLayout(
      'service-session-report',
      { serviceName: 'Grace Church Gathering', date: '1 Nov' } as any,
      { church_name: 'Grace Church' } as any,
      'Report',
      rules,
    );
    expect(html).toContain('Grace Church Gathering');
    expect(html.replace(/<style[\s\S]*?<\/style>/g, '')).not.toMatch(
      />[^<]*\bService\b[^<]*</,
    );
  });
});

describe('AccountTypeService', () => {
  const repo = {
    findOne: jest.fn(),
    create: jest.fn((r) => r),
    save: jest.fn(),
  };
  const cache = {
    getGlobal: jest.fn().mockResolvedValue(undefined),
    setGlobal: jest.fn(),
    delGlobal: jest.fn(),
  };
  const service = new AccountTypeService(repo as any, cache as any);

  const changeRepo = { find: jest.fn() };
  const tx = {
    save: jest.fn(),
    create: jest.fn((_entity, value) => value),
  };
  Object.assign(repo, {
    manager: { transaction: (fn: (m: typeof tx) => unknown) => fn(tx) },
  });
  const admin = new AccountTypeAdminService(
    repo as any,
    service,
    changeRepo as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    repo.findOne.mockResolvedValue(null);
  });

  it('changes nothing for a church by default', async () => {
    const profile = await service.getProfile(OrganisationTypeEnum.CHURCH);
    expect(profile.wording).toEqual([]);
    expect(Object.values(profile.modules).every((m) => m === 'on')).toBe(true);
    expect(Object.keys(profile.modules)).toHaveLength(KNOWN_MODULES.length);
  });

  it('gives other types their words and defaults', async () => {
    const profile = await service.getProfile(OrganisationTypeEnum.GROUP);
    expect(profile.wording).toContainEqual({ from: 'Church', to: 'Group' });
    expect(profile.modules.departments).toBe('off');
    expect(profile.modules.prayer).toBe('on');
  });

  it('lets the dictionary and availability be changed', async () => {
    repo.findOne.mockResolvedValue({
      value: {
        terms: { worker: { one: 'Servant', many: 'Servants' } },
        modules: { prayer: 'hidden' },
      },
    });
    const profile = await service.getProfile(OrganisationTypeEnum.MINISTRY);
    expect(profile.wording).toContainEqual({ from: 'Worker', to: 'Servant' });
    expect(profile.modules.prayer).toBe('hidden');
  });

  it('clears the cache on save, keeping earlier changes', async () => {
    repo.findOne.mockResolvedValue({
      value: { modules: { prayer: 'off' } },
    });
    await admin.update(
      OrganisationTypeEnum.GROUP,
      { modules: { notes: 'hidden' } },
      'admin-1',
    );
    expect(tx.save.mock.calls[0][0].value.modules).toEqual({
      prayer: 'off',
      notes: 'hidden',
    });
    expect(cache.delGlobal).toHaveBeenCalled();
    expect(tx.save.mock.calls[1][0]).toMatchObject({
      accountType: 'GROUP',
      actorId: 'admin-1',
      changes: { modules: { notes: 'hidden' } },
    });
  });

  it.each([
    [{ terms: { nope: { one: 'a', many: 'b' } } }],
    [{ terms: { worker: { one: '', many: 'b' } } }],
    [{ terms: { worker: { one: '<b>', many: 'b' } } }],
    [{ modules: { nope: 'on' } }],
    [{ modules: { prayer: 'maybe' } }],
  ])('rejects %j', async (dto) => {
    await expect(
      admin.update(OrganisationTypeEnum.GROUP, dto as any, 'admin-1'),
    ).rejects.toThrow(BadRequestException);
    expect(tx.save).not.toHaveBeenCalled();
  });

  it('opens sign-up per type, with NGO closed until opened', async () => {
    expect(await service.openSignupTypes()).toEqual(
      expect.not.arrayContaining([OrganisationTypeEnum.MINISTRY]),
    );
    repo.findOne.mockResolvedValue({ value: { signupOpen: true } });
    expect(await service.openSignupTypes()).toContain(
      OrganisationTypeEnum.MINISTRY,
    );
  });

  it('covers every module for every type', () => {
    for (const type of Object.values(OrganisationTypeEnum)) {
      expect(Object.keys(defaultAvailability(type))).toHaveLength(
        KNOWN_MODULES.length,
      );
    }
  });
});
