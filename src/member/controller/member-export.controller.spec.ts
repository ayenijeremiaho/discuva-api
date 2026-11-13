import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MemberController } from './member.controller';
import { MemberService } from '../service/member.service';
import { MemberTimelineService } from '../service/member-timeline.service';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { REQUIRES_PERMISSION_KEY } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import type { Response } from 'express';

describe('member export endpoints', () => {
  const service = {
    exportCsv: jest.fn().mockResolvedValue('\uFEFF"First Name"\r\n"Ada"\r\n'),
  };
  const controller = new MemberController(
    service as unknown as MemberService,
    {} as MemberTimelineService,
  );
  const response = { setHeader: jest.fn(), send: jest.fn() };
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['exportMembers', 'export'],
    ['exportWorkers', 'workers/export'],
  ] as const)('%s requires member-read admin access', (method, path) => {
    expect(Reflect.getMetadata(GUARDS_METADATA, controller[method])).toContain(
      AdminGuard,
    );
    expect(
      Reflect.getMetadata(REQUIRES_PERMISSION_KEY, controller[method]),
    ).toBe(AdminPermission.MEMBERS_READ);
    expect(Reflect.getMetadata(PATH_METADATA, controller[method])).toBe(path);
  });

  it('sends a CSV attachment rather than a JSON envelope', async () => {
    await controller.exportMembers(
      response as unknown as Response,
      undefined,
      'Ada',
      'true',
    );
    expect(service.exportCsv).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'Ada', wantsToServe: true }),
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/csv; charset=utf-8',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringMatching(/attachment; filename="members-.*\.csv"/),
    );
    expect(response.send).toHaveBeenCalledWith(
      expect.stringContaining('\uFEFF'),
    );
  });

  it('preserves the non-trainee filter', async () => {
    await controller.exportWorkers(
      response as unknown as Response,
      undefined,
      undefined,
      ' Ada ',
      'false',
    );
    expect(service.exportCsv).toHaveBeenCalledWith(
      expect.objectContaining({
        workers: true,
        search: 'Ada',
        isTrainee: false,
      }),
    );
  });
});
