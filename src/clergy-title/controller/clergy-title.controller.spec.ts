import { Test, TestingModule } from '@nestjs/testing';
import { ClergyTitleController } from './clergy-title.controller';
import { ClergyTitleService } from '../service/clergy-title.service';
import { AdminGuard } from '../../admin/guard/admin.guard';

const mockClergyTitleService = {
  getAll: jest.fn(),
  getOne: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

describe('ClergyTitleController', () => {
  let controller: ClergyTitleController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClergyTitleController],
      providers: [
        { provide: ClergyTitleService, useValue: mockClergyTitleService },
      ],
    })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(ClergyTitleController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getAll', () => {
    it('delegates to the service', async () => {
      const titles = [{ id: 'title-1', name: 'Priest' }];
      mockClergyTitleService.getAll.mockResolvedValue(titles);

      const result = await controller.getAll();

      expect(mockClergyTitleService.getAll).toHaveBeenCalledWith();
      expect(result).toEqual(titles);
    });
  });

  describe('getOne', () => {
    it('delegates to the service', async () => {
      const title = { id: 'title-1', name: 'Priest' };
      mockClergyTitleService.getOne.mockResolvedValue(title);

      const result = await controller.getOne('title-1');

      expect(mockClergyTitleService.getOne).toHaveBeenCalledWith('title-1');
      expect(result).toEqual(title);
    });
  });

  describe('create', () => {
    it('delegates to the service with the actor id', async () => {
      const dto = { name: 'Priest' };
      const user = { id: 'admin-1' } as any;
      mockClergyTitleService.create.mockResolvedValue({
        id: 'title-1',
        ...dto,
      });

      await controller.create(dto, user);

      expect(mockClergyTitleService.create).toHaveBeenCalledWith(
        dto,
        'admin-1',
      );
    });
  });

  describe('update', () => {
    it('delegates to the service with the actor id', async () => {
      const dto = { name: 'Bishop' };
      const user = { id: 'admin-1' } as any;

      await controller.update('title-1', dto, user);

      expect(mockClergyTitleService.update).toHaveBeenCalledWith(
        'title-1',
        dto,
        'admin-1',
      );
    });
  });

  describe('delete', () => {
    it('delegates to the service with the actor id', async () => {
      const user = { id: 'admin-1' } as any;

      await controller.delete('title-1', user);

      expect(mockClergyTitleService.delete).toHaveBeenCalledWith(
        'title-1',
        'admin-1',
      );
    });
  });
});
