import { Test, TestingModule } from '@nestjs/testing';
import { PushNotificationController } from './push-notification.controller';
import { PushNotificationService } from '../service/push-notification.service';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';

describe('PushNotificationController', () => {
  let controller: PushNotificationController;

  const mockPushService = {
    subscribe: jest.fn().mockResolvedValue(undefined),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PushNotificationController],
      providers: [
        { provide: PushNotificationService, useValue: mockPushService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PushNotificationController>(
      PushNotificationController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('subscribe', () => {
    it('calls pushService.subscribe with the member id from the request', async () => {
      const req = { user: { id: 'member-1' } };
      const dto = { endpoint: 'https://ep', p256dh: 'key', auth: 'auth' };
      await controller.subscribe(req, dto);
      expect(mockPushService.subscribe).toHaveBeenCalledWith('member-1', dto);
    });
  });

  describe('unsubscribe', () => {
    it('calls pushService.unsubscribe with the member id from the request', async () => {
      const req = { user: { id: 'member-1' } };
      await controller.unsubscribe(req);
      expect(mockPushService.unsubscribe).toHaveBeenCalledWith('member-1');
    });
  });
});
