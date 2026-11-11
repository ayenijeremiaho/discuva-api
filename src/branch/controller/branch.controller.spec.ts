import { Test, TestingModule } from '@nestjs/testing';
import { BranchController } from './branch.controller';
import { BranchRollupService } from '../service/branch-rollup.service';
import { AdminGuard } from '../../admin/guard/admin.guard';

const mockBranchRollupService = {
  getOverview: jest.fn(),
  getGivingSharing: jest.fn(),
  setGivingSharing: jest.fn(),
};

describe('BranchController', () => {
  let controller: BranchController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BranchController],
      providers: [
        { provide: BranchRollupService, useValue: mockBranchRollupService },
      ],
    })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(BranchController);
  });

  it('reads and sets whether giving is shared', () => {
    controller.getGivingSharing();
    controller.setGivingSharing({ shareGivingWithParent: true });
    expect(mockBranchRollupService.getGivingSharing).toHaveBeenCalled();
    expect(mockBranchRollupService.setGivingSharing).toHaveBeenCalledWith(true);
  });
});
