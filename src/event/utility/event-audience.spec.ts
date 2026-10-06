import { EventAudienceEnum } from '../enums/event-audience.enum';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { effectiveAudience, scopeToAudience } from './event-audience';

const fakeQb = () => {
  const qb = { andWhere: jest.fn() };
  qb.andWhere.mockReturnValue(qb);
  return qb as any;
};

describe('event audience', () => {
  it('leaves an everyone event unscoped', () => {
    const qb = fakeQb();
    scopeToAudience(qb, 'm', { audience: EventAudienceEnum.EVERYONE });
    expect(qb.andWhere).not.toHaveBeenCalled();
  });

  it('limits a workers event to workers, so members are never marked absent', () => {
    const qb = fakeQb();
    scopeToAudience(qb, 'm', { audience: EventAudienceEnum.WORKERS });
    expect(qb.andWhere).toHaveBeenCalledWith('m.role = :audienceRole', {
      audienceRole: MemberRoleEnum.WORKER,
    });
  });

  it('limits a group event to its members', () => {
    const qb = fakeQb();
    scopeToAudience(qb, 'm', {
      audience: EventAudienceEnum.GROUP,
      audienceGroupId: 'g1',
    });
    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('audience_gm.group_id = :audienceGroupId'),
      { audienceGroupId: 'g1' },
    );
  });

  it('treats a group event whose group was deleted as everyone', () => {
    expect(
      effectiveAudience({
        audience: EventAudienceEnum.GROUP,
        audienceGroupId: null,
      }),
    ).toBe(EventAudienceEnum.EVERYONE);
  });
});
