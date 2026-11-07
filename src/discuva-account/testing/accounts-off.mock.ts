import { UtilityService } from '../../utility/service/utility.service';

type Fn = (memberId: string) => Promise<unknown>;

// DiscuvaAccountService with the switch off: everything acts on this church's member record.
export function accountsOffMock(
  hooks: {
    updateMember?: (id: string, patch: Record<string, unknown>) => unknown;
    endSessions?: (memberId: string) => unknown;
  } = {},
) {
  const forEachChurchOf = jest.fn(
    async (
      member: { id: string },
      fn: Fn,
      options: { skipCurrent?: boolean } = {},
    ) => {
      if (!options.skipCurrent) await fn(member.id);
    },
  );
  return {
    isOn: jest.fn().mockResolvedValue(false),
    accountFor: jest.fn().mockResolvedValue(null),
    hasAccount: jest.fn().mockResolvedValue(false),
    verifyPassword: jest.fn((member: { password: string }, password: string) =>
      UtilityService.verifyHashedValue(password, member.password),
    ),
    deviceOf: jest.fn(
      async (member: { deviceId?: string | null }) => member.deviceId ?? null,
    ),
    moveOnSignIn: jest.fn().mockResolvedValue('NONE'),
    setDevice: jest.fn(
      async (member: { id: string }, deviceId: string | null) => {
        await hooks.updateMember?.(member.id, { deviceId });
      },
    ),
    setPasswordHash: jest.fn(
      async (
        member: { id: string },
        password: string,
        changedPassword: boolean,
      ) => {
        await hooks.updateMember?.(member.id, { password, changedPassword });
      },
    ),
    endSessionsEverywhere: jest.fn(
      async (
        member: { id: string },
        options: { skipCurrent?: boolean } = {},
      ) => {
        if (!options.skipCurrent) await hooks.endSessions?.(member.id);
      },
    ),
    forEachChurchOf,
    purgeCodes: jest.fn().mockResolvedValue(undefined),
  };
}
