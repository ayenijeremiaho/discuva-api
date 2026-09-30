import { BadRequestException } from '@nestjs/common';
import { TitheMemberController } from './tithe-member.controller';
import { TitheProofStatus } from '../enum/tithe.enum';

jest.mock('../../utility/interceptors/limited-file.interceptor', () => ({
  LimitedFileInterceptor: () => class {},
}));

describe('TitheMemberController', () => {
  const service = {
    getMyProofs: jest.fn().mockResolvedValue({ data: [] }),
    getMyGivingSummary: jest.fn().mockResolvedValue({}),
    emailPledgeContributionStatement: jest.fn().mockResolvedValue({}),
  };
  const controller = new TitheMemberController(service as any);
  const req = { user: { id: 'm1' } };

  beforeEach(() => jest.clearAllMocks());

  it('parses a comma list of proof statuses', async () => {
    await controller.getMyProofs(req, 1, 20, 'pending, DECLINED');
    expect(service.getMyProofs).toHaveBeenCalledWith(req.user, 1, 20, [
      TitheProofStatus.PENDING,
      TitheProofStatus.DECLINED,
    ]);
  });

  it('passes no filter when status is omitted, and rejects unknown ones', async () => {
    await controller.getMyProofs(req, 1, 20);
    expect(service.getMyProofs).toHaveBeenCalledWith(
      req.user,
      1,
      20,
      undefined,
    );
    expect(() => controller.getMyProofs(req, 1, 20, 'APPROVED')).toThrow(
      BadRequestException,
    );
  });

  it('validates the summary year', () => {
    expect(() => controller.getMySummary(req, 1999)).toThrow(
      BadRequestException,
    );
    controller.getMySummary(req, 2026);
    expect(service.getMyGivingSummary).toHaveBeenCalledWith(req.user, 2026);
  });

  it('passes the pledge statement range and campaign through, and validates months', () => {
    controller.emailPledgeStatement(req, '2026-01', '2026-06', 'camp-1');
    expect(service.emailPledgeContributionStatement).toHaveBeenCalledWith(
      req.user,
      '2026-01',
      '2026-06',
      'camp-1',
    );
    expect(() => controller.emailPledgeStatement(req, '2026-13')).toThrow(
      BadRequestException,
    );
    expect(() =>
      controller.emailPledgeStatement(req, '2026-06', '2026-01'),
    ).toThrow(BadRequestException);
  });
});
