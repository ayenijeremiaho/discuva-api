import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { QueryFailedError, Repository } from 'typeorm';
import { SessionSurface } from '../../auth/enum/session-surface.enum';
import { MemberSession } from '../entity/member-session.entity';
import { MemberSessionService } from './member-session.service';

describe('MemberSessionService', () => {
  const sessionRepository = {
    findOne: jest.fn<() => Promise<MemberSession | null>>(),
    create: jest.fn((session: Partial<MemberSession>) => session),
    save: jest.fn<() => Promise<MemberSession>>(),
  };
  const service = new MemberSessionService(
    sessionRepository as unknown as Repository<MemberSession>,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    sessionRepository.findOne.mockResolvedValue(null);
  });

  it('rejects the session when the member row disappears before it is saved', async () => {
    sessionRepository.save.mockRejectedValue(
      new QueryFailedError(
        'INSERT INTO member_sessions',
        [],
        Object.assign(new Error(), {
          code: '23503',
          constraint: 'FK_member_sessions_member_id',
        }),
      ),
    );

    await expect(
      service.updateLogin('member-1', 'hashed-token', SessionSurface.MEMBER),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('preserves unrelated database errors', async () => {
    const error = new Error('database unavailable');
    sessionRepository.save.mockRejectedValue(error);

    await expect(
      service.updateLogin('member-1', 'hashed-token', SessionSurface.MEMBER),
    ).rejects.toBe(error);
  });
});
