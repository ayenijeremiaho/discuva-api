import { BadRequestException } from '@nestjs/common';
import { FinanceAdminController } from './finance-admin.controller';

describe('FinanceAdminController status filter', () => {
  const service = {
    getAllRequests: jest.fn().mockResolvedValue({ data: [] }),
  };
  const controller = new FinanceAdminController(service as any);

  it.each(['PENDING', 'APPROVED', 'REJECTED', 'PAID', 'AWAITING_PAYMENT'])(
    'accepts %s',
    (status) => {
      controller.getAllRequests(1, 20, status as any);
      expect(service.getAllRequests).toHaveBeenLastCalledWith(
        1,
        20,
        status,
        undefined,
        undefined,
        undefined,
        undefined,
      );
    },
  );

  it('rejects an unknown status', () => {
    expect(() => controller.getAllRequests(1, 20, 'SETTLED' as any)).toThrow(
      BadRequestException,
    );
  });
});
