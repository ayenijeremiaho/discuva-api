import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { SocialAccountService } from './social-account.service';
import { SocialAccount } from '../entity/social-account.entity';
import { SocialPlatform } from '../enum/social-media.enum';

const mockAccountRepo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  save: jest.fn(),
  create: jest.fn((v) => v),
  remove: jest.fn(),
};

describe('SocialAccountService', () => {
  let service: SocialAccountService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocialAccountService,
        {
          provide: getRepositoryToken(SocialAccount),
          useValue: mockAccountRepo,
        },
      ],
    }).compile();
    service = module.get(SocialAccountService);
  });

  describe('create', () => {
    it('registers an account as not yet connected', async () => {
      mockAccountRepo.save.mockImplementation((a) =>
        Promise.resolve({ id: 'acc-1', ...a }),
      );

      const result = await service.create({
        platform: SocialPlatform.FACEBOOK,
        displayName: 'Main Church Page',
      });

      expect(mockAccountRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: SocialPlatform.FACEBOOK,
          displayName: 'Main Church Page',
          isConnected: false,
        }),
      );
      expect(result.id).toBe('acc-1');
    });
  });

  describe('delete', () => {
    it('removes an existing account', async () => {
      const account = { id: 'acc-1' };
      mockAccountRepo.findOneBy.mockResolvedValue(account);

      await service.delete('acc-1');

      expect(mockAccountRepo.remove).toHaveBeenCalledWith(account);
    });

    it('throws NotFoundException for an unknown account', async () => {
      mockAccountRepo.findOneBy.mockResolvedValue(null);
      await expect(service.delete('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
