import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MemberController } from './member.controller';
import { MemberService } from '../service/member.service';
import { MemberTimelineService } from '../service/member-timeline.service';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { REQUIRES_PERMISSION_KEY } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { REQUIRES_PLAN_KEY } from '../../billing/decorator/requires-plan.decorator';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';
import { PlanGuard } from '../../billing/guard/plan.guard';
import { Admin } from '../../admin/entity/admin.entity';

describe('member email export endpoints', () => {
  const service = { emailExport: jest.fn().mockResolvedValue(undefined) };
  const controller = new MemberController(
    service as unknown as MemberService,
    {} as MemberTimelineService,
  );
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['exportMembers', 'export-email'],
    ['exportWorkers', 'workers/export-email'],
  ] as const)(
    '%s requires member-read admin access and the bulk-export plan',
    (method, path) => {
      expect(Reflect.getMetadata(GUARDS_METADATA, controller[method])).toEqual([
        AdminGuard,
        PlanGuard,
      ]);
      expect(
        Reflect.getMetadata(REQUIRES_PERMISSION_KEY, controller[method]),
      ).toBe(AdminPermission.MEMBERS_READ);
      expect(Reflect.getMetadata(REQUIRES_PLAN_KEY, controller[method])).toBe(
        PlanFeature.BULK_EXPORT,
      );
      expect(Reflect.getMetadata(PATH_METADATA, controller[method])).toBe(path);
    },
  );

  it('passes the member filters and authenticated admin', async () => {
    const admin = { id: 'admin-1' } as Admin;
    const dto = { search: 'Ada', wantsToServe: true };
    await controller.exportMembers(dto, admin);
    expect(service.emailExport).toHaveBeenCalledWith(dto, admin);
  });

  it('passes worker filters without losing false', async () => {
    const admin = { id: 'admin-1' } as Admin;
    const dto = { search: 'Ada', isTrainee: false };
    await controller.exportWorkers(dto, admin);
    expect(service.emailExport).toHaveBeenCalledWith(dto, admin, true);
  });
});
