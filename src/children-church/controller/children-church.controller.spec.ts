import { Test, TestingModule } from '@nestjs/testing';
import { ChildrenChurchController } from './children-church.controller';
import { ChildrenChurchService } from '../service/children-church.service';
import { ChildCheckInStatusEnum } from '../enums/child-checkin-status.enum';
import { GuardianRelationshipEnum } from '../enums/guardian-relationship.enum';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { SessionSurface } from '../../auth/enum/session-surface.enum';

const mockChildrenChurchService = {
  createAgeGroup: jest.fn(),
  updateAgeGroup: jest.fn(),
  deleteAgeGroup: jest.fn(),
  getAllAgeGroups: jest.fn(),
  batchRecomputeAgeGroups: jest.fn(),
  createClassGroup: jest.fn(),
  updateClassGroup: jest.fn(),
  deleteClassGroup: jest.fn(),
  getClassGroupsByAgeGroup: jest.fn(),
  registerChild: jest.fn(),
  updateChild: jest.fn(),
  getChild: jest.fn(),
  searchChildren: jest.fn(),
  addGuardian: jest.fn(),
  getChildGuardians: jest.fn(),
  removeGuardian: jest.fn(),
  checkIn: jest.fn(),
  verifyPickupCode: jest.fn(),
  checkOut: jest.fn(),
  flagCheckIn: jest.fn(),
  getActiveCheckIns: jest.fn(),
  getCheckInsBySlot: jest.fn(),
};

const mockUser = {
  id: 'worker-1',
  role: MemberRoleEnum.WORKER,
  requiresPasswordChange: false,
  surface: SessionSurface.MEMBER,
};
const mockReq = { user: mockUser };

describe('ChildrenChurchController', () => {
  let controller: ChildrenChurchController;

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChildrenChurchController],
      providers: [
        { provide: ChildrenChurchService, useValue: mockChildrenChurchService },
      ],
    })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ModuleEnabledGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ChildrenChurchController>(ChildrenChurchController);
  });

  // ─── Age Groups (ADMIN-only, no req.user forwarded) ───────────────────────

  it('createAgeGroup — delegates to service', async () => {
    const dto = { name: 'Nursery', minAgeMonths: 0, maxAgeMonths: 23 };
    mockChildrenChurchService.createAgeGroup.mockResolvedValue({
      id: 'ag-1',
      ...dto,
    });

    const result = await controller.createAgeGroup(dto as any);

    expect(mockChildrenChurchService.createAgeGroup).toHaveBeenCalledWith(dto);
    expect(result).toMatchObject({ id: 'ag-1' });
  });

  it('updateAgeGroup — passes id and dto', async () => {
    mockChildrenChurchService.updateAgeGroup.mockResolvedValue({
      id: 'ag-1',
      name: 'Updated',
    });

    await controller.updateAgeGroup('ag-1', { name: 'Updated' } as any);

    expect(mockChildrenChurchService.updateAgeGroup).toHaveBeenCalledWith(
      'ag-1',
      { name: 'Updated' },
    );
  });

  it('deleteAgeGroup — calls service with id', async () => {
    mockChildrenChurchService.deleteAgeGroup.mockResolvedValue(undefined);

    await controller.deleteAgeGroup('ag-1');

    expect(mockChildrenChurchService.deleteAgeGroup).toHaveBeenCalledWith(
      'ag-1',
    );
  });

  it('getAllAgeGroups — delegates to service', async () => {
    mockChildrenChurchService.getAllAgeGroups.mockResolvedValue([]);

    await controller.getAllAgeGroups();

    expect(mockChildrenChurchService.getAllAgeGroups).toHaveBeenCalled();
  });

  it('batchRecomputeAgeGroups — delegates to service', async () => {
    mockChildrenChurchService.batchRecomputeAgeGroups.mockResolvedValue({
      updated: 5,
    });

    const result = await controller.batchRecomputeAgeGroups();

    expect(
      mockChildrenChurchService.batchRecomputeAgeGroups,
    ).toHaveBeenCalled();
    expect(result).toEqual({ updated: 5 });
  });

  it('createClassGroup — delegates to service', async () => {
    const dto = { ageGroupId: 'ag-1', name: 'Room A' };
    mockChildrenChurchService.createClassGroup.mockResolvedValue({
      id: 'cg-1',
      ...dto,
    });

    await controller.createClassGroup(dto as any);

    expect(mockChildrenChurchService.createClassGroup).toHaveBeenCalledWith(
      dto,
    );
  });

  it('getClassGroupsByAgeGroup — passes ageGroupId query', async () => {
    mockChildrenChurchService.getClassGroupsByAgeGroup.mockResolvedValue([]);

    await controller.getClassGroupsByAgeGroup('ag-1');

    expect(
      mockChildrenChurchService.getClassGroupsByAgeGroup,
    ).toHaveBeenCalledWith('ag-1');
  });

  it('getCheckInsBySlot — passes slotId with default pagination', async () => {
    mockChildrenChurchService.getCheckInsBySlot.mockResolvedValue({
      data: [],
      meta: {},
    });

    await controller.getCheckInsBySlot('slot-1', 1, 20);

    expect(mockChildrenChurchService.getCheckInsBySlot).toHaveBeenCalledWith(
      'slot-1',
      1,
      20,
    );
  });

  // ─── Children (req.user forwarded) ───────────────────────────────────────

  it('registerChild — passes req.user and dto', async () => {
    const dto = {
      firstname: 'Alice',
      lastname: 'Smith',
      dateOfBirth: '2024-01-15',
    };
    mockChildrenChurchService.registerChild.mockResolvedValue({
      id: 'child-1',
      ...dto,
    });

    await controller.registerChild(mockReq, dto as any);

    expect(mockChildrenChurchService.registerChild).toHaveBeenCalledWith(
      mockUser,
      dto,
    );
  });

  it('updateChild — passes req.user, id, and dto', async () => {
    mockChildrenChurchService.updateChild.mockResolvedValue({ id: 'child-1' });

    await controller.updateChild(mockReq, 'child-1', {
      firstname: 'Alicia',
    } as any);

    expect(mockChildrenChurchService.updateChild).toHaveBeenCalledWith(
      mockUser,
      'child-1',
      { firstname: 'Alicia' },
    );
  });

  it('getChild — passes req.user and id', async () => {
    mockChildrenChurchService.getChild.mockResolvedValue({ id: 'child-1' });

    await controller.getChild(mockReq, 'child-1');

    expect(mockChildrenChurchService.getChild).toHaveBeenCalledWith(
      mockUser,
      'child-1',
    );
  });

  it('searchChildren — passes req.user, name, coerced page/limit, and classGroupId', async () => {
    mockChildrenChurchService.searchChildren.mockResolvedValue({
      data: [],
      totalCount: 0,
    });

    await controller.searchChildren(mockReq, 'Alice', 'cg-1', 2, 10);

    expect(mockChildrenChurchService.searchChildren).toHaveBeenCalledWith(
      mockUser,
      'Alice',
      2,
      10,
      'cg-1',
    );
  });

  it('searchChildren — works without classGroupId', async () => {
    mockChildrenChurchService.searchChildren.mockResolvedValue({
      data: [],
      totalCount: 0,
    });

    await controller.searchChildren(mockReq, 'Alice', undefined, 2, 10);

    expect(mockChildrenChurchService.searchChildren).toHaveBeenCalledWith(
      mockUser,
      'Alice',
      2,
      10,
      undefined,
    );
  });

  // ─── Guardians ────────────────────────────────────────────────────────────

  it('addGuardian — passes req.user, childId, and dto', async () => {
    const dto = {
      fullName: 'Jane',
      relationship: GuardianRelationshipEnum.MOTHER,
    };
    mockChildrenChurchService.addGuardian.mockResolvedValue({ id: 'g-1' });

    await controller.addGuardian(mockReq, 'child-1', dto as any);

    expect(mockChildrenChurchService.addGuardian).toHaveBeenCalledWith(
      mockUser,
      'child-1',
      dto,
    );
  });

  it('getChildGuardians — passes req.user and childId', async () => {
    mockChildrenChurchService.getChildGuardians.mockResolvedValue([]);

    await controller.getChildGuardians(mockReq, 'child-1');

    expect(mockChildrenChurchService.getChildGuardians).toHaveBeenCalledWith(
      mockUser,
      'child-1',
    );
  });

  it('removeGuardian — passes req.user and guardian id', async () => {
    mockChildrenChurchService.removeGuardian.mockResolvedValue(undefined);

    await controller.removeGuardian(mockReq, 'g-1');

    expect(mockChildrenChurchService.removeGuardian).toHaveBeenCalledWith(
      mockUser,
      'g-1',
    );
  });

  // ─── Check-In / Check-Out ─────────────────────────────────────────────────

  it('checkIn — passes req.user and dto', async () => {
    const dto = { childId: 'child-1', serviceSlotId: 'slot-1' };
    mockChildrenChurchService.checkIn.mockResolvedValue({
      id: 'ci-1',
      pickupCode: 'ABC123',
      status: ChildCheckInStatusEnum.CHECKED_IN,
    });

    const result = await controller.checkIn(mockReq, dto as any);

    expect(mockChildrenChurchService.checkIn).toHaveBeenCalledWith(
      mockUser,
      dto,
    );
    expect(result.pickupCode).toBe('ABC123');
  });

  it('verifyPickupCode — passes req.user and code', async () => {
    mockChildrenChurchService.verifyPickupCode.mockResolvedValue({
      id: 'ci-1',
    });

    await controller.verifyPickupCode(mockReq, 'ABC123');

    expect(mockChildrenChurchService.verifyPickupCode).toHaveBeenCalledWith(
      mockUser,
      'ABC123',
    );
  });

  it('checkOut — passes req.user and dto', async () => {
    const dto = { pickupCode: 'ABC123' };
    mockChildrenChurchService.checkOut.mockResolvedValue({
      id: 'ci-1',
      status: ChildCheckInStatusEnum.CHECKED_OUT,
    });

    const result = await controller.checkOut(mockReq, dto as any);

    expect(mockChildrenChurchService.checkOut).toHaveBeenCalledWith(
      mockUser,
      dto,
    );
    expect(result.status).toBe(ChildCheckInStatusEnum.CHECKED_OUT);
  });

  it('flagCheckIn — passes req.user, id, and reason dto', async () => {
    const dto = { reason: 'Unknown person at pickup' };
    mockChildrenChurchService.flagCheckIn.mockResolvedValue({
      id: 'ci-1',
      status: ChildCheckInStatusEnum.FLAGGED,
    });

    await controller.flagCheckIn(mockReq, 'ci-1', dto as any);

    expect(mockChildrenChurchService.flagCheckIn).toHaveBeenCalledWith(
      mockUser,
      'ci-1',
      dto,
    );
  });

  it('getActiveCheckIns — passes req.user and optional classGroupId', async () => {
    mockChildrenChurchService.getActiveCheckIns.mockResolvedValue([]);

    await controller.getActiveCheckIns(mockReq, 'cg-1');

    expect(mockChildrenChurchService.getActiveCheckIns).toHaveBeenCalledWith(
      mockUser,
      'cg-1',
    );
  });

  it('getActiveCheckIns — works without classGroupId', async () => {
    mockChildrenChurchService.getActiveCheckIns.mockResolvedValue([]);

    await controller.getActiveCheckIns(mockReq);

    expect(mockChildrenChurchService.getActiveCheckIns).toHaveBeenCalledWith(
      mockUser,
      undefined,
    );
  });
});
