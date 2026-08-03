import { Test, TestingModule } from '@nestjs/testing';
import { PlatformAdminRoleController } from './platform-admin-role.controller';
import { PlatformAdminRoleService } from '../service/platform-admin-role.service';
import { PlatformAdminGuard } from '../guard/platform-admin.guard';

const mockRoleService = {
  getAll: jest.fn(),
  getById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

describe('PlatformAdminRoleController', () => {
  let controller: PlatformAdminRoleController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlatformAdminRoleController],
      providers: [
        { provide: PlatformAdminRoleService, useValue: mockRoleService },
      ],
    })
      .overrideGuard(PlatformAdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(PlatformAdminRoleController);
  });

  it('getAll delegates to the service', () => {
    controller.getAll();
    expect(mockRoleService.getAll).toHaveBeenCalled();
  });

  it('getOne delegates with the id', () => {
    controller.getOne('role-1');
    expect(mockRoleService.getById).toHaveBeenCalledWith('role-1');
  });

  it('create delegates with the dto', () => {
    const dto = { name: 'Support', permissions: [] } as any;
    controller.create(dto);
    expect(mockRoleService.create).toHaveBeenCalledWith(dto);
  });

  it('update delegates with id and dto', () => {
    const dto = { description: 'x' } as any;
    controller.update('role-1', dto);
    expect(mockRoleService.update).toHaveBeenCalledWith('role-1', dto);
  });

  it('delete delegates with the id', async () => {
    await controller.delete('role-1');
    expect(mockRoleService.delete).toHaveBeenCalledWith('role-1');
  });
});
