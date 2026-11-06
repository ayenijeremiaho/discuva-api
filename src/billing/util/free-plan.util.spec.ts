import { OrganisationTypeEnum } from '../../tenant/enum/organisation-type.enum';
import {
  freePlanId,
  isFreePlan,
  startingPlanId,
  tenantFreePlanId,
} from './free-plan.util';

describe('free plan per account type', () => {
  it('gives groups their own free plan and churches and ministries the shared one', () => {
    expect(freePlanId(OrganisationTypeEnum.GROUP)).toBe('group-free');
    expect(freePlanId(OrganisationTypeEnum.CHURCH)).toBe('free');
    expect(freePlanId(OrganisationTypeEnum.MINISTRY)).toBe('free');
    expect(freePlanId(undefined)).toBe('free');
  });

  it('treats every free plan, and no plan, as free', () => {
    expect(isFreePlan('free')).toBe(true);
    expect(isFreePlan('group-free')).toBe(true);
    expect(isFreePlan(null)).toBe(true);
    expect(isFreePlan('pro')).toBe(false);
    expect(isFreePlan('group-pro')).toBe(false);
  });

  it('starts a new group on the group free plan even when sign-up asked for "free"', () => {
    expect(startingPlanId(OrganisationTypeEnum.GROUP, 'free')).toBe(
      'group-free',
    );
    expect(startingPlanId(OrganisationTypeEnum.CHURCH, undefined)).toBe('free');
  });

  it('keeps a chosen paid plan, and a sponsored plan wins over both', () => {
    expect(startingPlanId(OrganisationTypeEnum.CHURCH, 'pro')).toBe('pro');
    expect(
      startingPlanId(OrganisationTypeEnum.CHURCH, 'free', 'pro-annual'),
    ).toBe('pro-annual');
  });

  it("looks up the tenant's type to pick its free plan", async () => {
    const repo = {
      findOne: jest.fn().mockResolvedValue({ orgType: 'GROUP' }),
    } as any;
    await expect(tenantFreePlanId(repo, 't1')).resolves.toBe('group-free');
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { id: 't1' },
      select: { id: true, orgType: true },
    });
  });
});
