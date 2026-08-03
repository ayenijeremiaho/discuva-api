import { Test, TestingModule } from '@nestjs/testing';
import { PlatformAdminManagementController } from './platform-admin-management.controller';
import { PlatformAdminManagementService } from '../service/platform-admin-management.service';
import { PlatformAdminGuard } from '../guard/platform-admin.guard';
import { PlatformAdminAuth } from '../interface/platform-admin-auth.interface';

const mockManagementService = {
  getAll: jest.fn(),
  getById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};

const mockAdmin: PlatformAdminAuth = {
  id: 'admin-1',
  email: 'admin@example.com',
  role: 'platform_admin',
  permissions: ['platform_admins:write'],
};

describe('PlatformAdminManagementController', () => {
  let controller: PlatformAdminManagementController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlatformAdminManagementController],
      providers: [
        {
          provide: PlatformAdminManagementService,
          useValue: mockManagementService,
        },
      ],
    })
      .overrideGuard(PlatformAdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(PlatformAdminManagementController);
  });

  it('getAll delegates to the service', () => {
    controller.getAll();
    expect(mockManagementService.getAll).toHaveBeenCalled();
  });

  it('getMe resolves the current admin by id from the token, not a route param', () => {
    controller.getMe(mockAdmin);
    expect(mockManagementService.getById).toHaveBeenCalledWith('admin-1');
  });

  it('getOne delegates with the id', () => {
    controller.getOne('admin-2');
    expect(mockManagementService.getById).toHaveBeenCalledWith('admin-2');
  });

  it('create delegates with the dto', () => {
    const dto = {
      email: 'x@example.com',
      platformAdminRoleId: 'role-1',
    };
    controller.create(dto);
    expect(mockManagementService.create).toHaveBeenCalledWith(dto);
  });

  it('update delegates with id, dto, and the acting admin id', () => {
    const dto = { isActive: false };
    controller.update('admin-2', dto, mockAdmin);
    expect(mockManagementService.update).toHaveBeenCalledWith(
      'admin-2',
      dto,
      'admin-1',
    );
  });
});
