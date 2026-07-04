import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import * as webPush from 'web-push';
import { PushNotificationService } from './push-notification.service';
import { PushSubscription } from '../entity/push-subscription.entity';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

describe('PushNotificationService', () => {
  let service: PushNotificationService;

  const mockSubRepo = {
    delete: jest.fn().mockResolvedValue(undefined),
    save: jest.fn().mockResolvedValue(undefined),
    create: jest.fn().mockImplementation((v) => v),
    find: jest.fn().mockResolvedValue([]),
  };

  const mockWorkerRepo = {
    createQueryBuilder: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    }),
  };

  const mockQueue = {
    add: jest.fn().mockResolvedValue(undefined),
  };

  const mockConfig = {
    get: jest.fn().mockReturnValue('test-value'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PushNotificationService,
        { provide: getRepositoryToken(PushSubscription), useValue: mockSubRepo },
        { provide: getRepositoryToken(WorkerProfile), useValue: mockWorkerRepo },
        { provide: getQueueToken('push-notifications'), useValue: mockQueue },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<PushNotificationService>(PushNotificationService);
    service.onModuleInit();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('onModuleInit sets VAPID details', () => {
    expect(webPush.setVapidDetails).toHaveBeenCalledWith(
      'test-value',
      'test-value',
      'test-value',
    );
  });

  describe('subscribe', () => {
    it('deletes existing subscription then saves new one', async () => {
      const dto = { endpoint: 'https://push.example.com/sub', p256dh: 'key', auth: 'auth' };
      await service.subscribe('member-1', dto);
      expect(mockSubRepo.delete).toHaveBeenCalledWith({ memberId: 'member-1' });
      expect(mockSubRepo.save).toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    it('deletes the subscription for the given member', async () => {
      await service.unsubscribe('member-1');
      expect(mockSubRepo.delete).toHaveBeenCalledWith({ memberId: 'member-1' });
    });
  });

  describe('dispatchToMemberIds', () => {
    it('does nothing when memberIds is empty', async () => {
      await service.dispatchToMemberIds([], { idempotencyKey: 'k', title: 't', body: 'b', url: '/u' });
      expect(mockSubRepo.find).not.toHaveBeenCalled();
    });

    it('enqueues one job per subscription found', async () => {
      mockSubRepo.find.mockResolvedValueOnce([
        { memberId: 'member-1', endpoint: 'https://ep', p256dh: 'k', auth: 'a' },
      ]);
      await service.dispatchToMemberIds(['member-1'], {
        idempotencyKey: 'prayer-test:1',
        title: 'Test',
        body: 'Body',
        url: '/prayer',
      });
      expect(mockQueue.add).toHaveBeenCalledWith(
        'send',
        expect.objectContaining({ memberId: 'member-1' }),
        expect.objectContaining({ jobId: 'push:member-1:prayer-test:1' }),
      );
    });

    it('skips members without a subscription', async () => {
      mockSubRepo.find.mockResolvedValueOnce([]);
      await service.dispatchToMemberIds(['member-no-sub'], {
        idempotencyKey: 'k',
        title: 't',
        body: 'b',
        url: '/',
      });
      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('dispatchToWorkerProfileIds', () => {
    it('does nothing when workerProfileIds is empty', async () => {
      await service.dispatchToWorkerProfileIds([], { idempotencyKey: 'k', title: 't', body: 'b', url: '/' });
      expect(mockWorkerRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('resolves member IDs and dispatches', async () => {
      mockWorkerRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([{ memberId: 'member-1' }]),
      });
      mockSubRepo.find.mockResolvedValueOnce([
        { memberId: 'member-1', endpoint: 'https://ep', p256dh: 'k', auth: 'a' },
      ]);
      await service.dispatchToWorkerProfileIds(['wp-1'], {
        idempotencyKey: 'prayer-auto-assign:prog:1:2026',
        title: 'Prayer',
        body: 'B',
        url: '/prayer',
      });
      expect(mockQueue.add).toHaveBeenCalledTimes(1);
    });
  });
});
