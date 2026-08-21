import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { SmsService } from './sms.service';
import { SmsProviderRegistryService } from './sms-provider-registry.service';
import { SmsCredentialResolverService } from '../../communication-provider/service/sms-credential-resolver.service';

describe('SmsService', () => {
  let service: SmsService;
  const mockProvider = {
    maxRecipientsPerRequest: 100,
    send: jest.fn(),
    getBalance: jest.fn(),
    getMessageHistory: jest.fn(),
  };
  const mockRegistry = { get: jest.fn().mockReturnValue(mockProvider) };
  // Pure BYOK — pure resolveConfig() returning a config means "tenant has
  // an active SMS provider configured"; undefined means they don't, which
  // every method must reject rather than silently falling back to anything.
  const mockCredentialResolver = {
    resolveConfig: jest.fn().mockResolvedValue({
      providerId: 'termii',
      credentials: { apiKey: 'tenant-key', senderId: 'TenantChurch' },
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRegistry.get.mockReturnValue(mockProvider);
    mockCredentialResolver.resolveConfig.mockResolvedValue({
      providerId: 'termii',
      credentials: { apiKey: 'tenant-key', senderId: 'TenantChurch' },
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmsService,
        { provide: SmsProviderRegistryService, useValue: mockRegistry },
        {
          provide: SmsCredentialResolverService,
          useValue: mockCredentialResolver,
        },
      ],
    }).compile();
    service = module.get<SmsService>(SmsService);
  });

  describe('calculateSegments', () => {
    it('treats a 159-character plain message as 1 segment', () => {
      const result = service.calculateSegments('a'.repeat(159));
      expect(result).toEqual({
        segments: 1,
        encoding: 'plain',
        characterCount: 159,
      });
    });

    it('treats exactly 160 plain characters as 1 segment', () => {
      const result = service.calculateSegments('a'.repeat(160));
      expect(result.segments).toBe(1);
      expect(result.encoding).toBe('plain');
    });

    it('treats 161 plain characters as 2 segments', () => {
      const result = service.calculateSegments('a'.repeat(161));
      expect(result.segments).toBe(2);
      expect(result.encoding).toBe('plain');
    });

    it('forces unicode encoding and 70-char segments for an emoji', () => {
      const result = service.calculateSegments('Hello 🎉');
      expect(result.encoding).toBe('unicode');
      expect(result.segments).toBe(1);
    });

    it('forces unicode for Termii-documented special characters even in otherwise plain ASCII', () => {
      const result = service.calculateSegments('Reply YES{no}');
      expect(result.encoding).toBe('unicode');
    });

    it('returns 0 segments for an empty message', () => {
      const result = service.calculateSegments('');
      expect(result.segments).toBe(0);
    });
  });

  describe('send', () => {
    it('throws ForbiddenException with SMS_PROVIDER_NOT_CONFIGURED when no active provider is configured', async () => {
      mockCredentialResolver.resolveConfig.mockResolvedValue(undefined);

      await expect(service.send(['+1'], 'Hello')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockProvider.send).not.toHaveBeenCalled();
    });

    it('dispatches to the provider resolved from the registry by providerId', async () => {
      mockProvider.send.mockResolvedValue({ messageId: '1', status: 'ok' });
      const to = Array.from({ length: 5 }, (_, i) => `+23480000000${i}`);

      const results = await service.send(to, 'Hello');

      expect(mockRegistry.get).toHaveBeenCalledWith('termii');
      expect(mockProvider.send).toHaveBeenCalledTimes(1);
      expect(mockProvider.send).toHaveBeenCalledWith(to, 'Hello', 'plain', {
        apiKey: 'tenant-key',
        senderId: 'TenantChurch',
      });
      expect(results).toHaveLength(1);
    });

    it('routes to the tenant-selected vendor, not a hardcoded one', async () => {
      mockCredentialResolver.resolveConfig.mockResolvedValue({
        providerId: 'twilio',
        credentials: {
          accountSid: 'AC1',
          authToken: 'secret',
          fromNumber: '+1000',
        },
      });
      mockProvider.send.mockResolvedValue({ messageId: '1', status: 'ok' });

      await service.send(['+1'], 'Hello');

      expect(mockRegistry.get).toHaveBeenCalledWith('twilio');
    });

    it('splits recipients into multiple batches using the resolved provider max', async () => {
      mockProvider.maxRecipientsPerRequest = 100;
      mockProvider.send.mockResolvedValue({ messageId: '1', status: 'ok' });
      const to = Array.from(
        { length: mockProvider.maxRecipientsPerRequest + 10 },
        (_, i) => `+234800000${i}`,
      );

      await service.send(to, 'Hello');

      expect(mockProvider.send).toHaveBeenCalledTimes(2);
      expect(mockProvider.send.mock.calls[0][0]).toHaveLength(
        mockProvider.maxRecipientsPerRequest,
      );
      expect(mockProvider.send.mock.calls[1][0]).toHaveLength(10);
    });

    it('does not let one failed batch stop the others', async () => {
      mockProvider.maxRecipientsPerRequest = 100;
      mockProvider.send
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ messageId: '2', status: 'ok' });
      const to = Array.from(
        { length: mockProvider.maxRecipientsPerRequest + 1 },
        (_, i) => `+234800000${i}`,
      );

      const results = await service.send(to, 'Hello');

      expect(results).toHaveLength(1);
    });
  });

  describe('getBalance', () => {
    it('throws ForbiddenException when no active provider is configured', async () => {
      mockCredentialResolver.resolveConfig.mockResolvedValue(undefined);
      await expect(service.getBalance()).rejects.toThrow(ForbiddenException);
    });

    it('delegates to the resolved provider', async () => {
      mockProvider.getBalance.mockResolvedValue({
        balance: 100,
        currency: 'NGN',
      });
      const result = await service.getBalance();
      expect(result).toEqual({ balance: 100, currency: 'NGN' });
    });
  });

  describe('getLogs', () => {
    it('throws ForbiddenException when no active provider is configured', async () => {
      mockCredentialResolver.resolveConfig.mockResolvedValue(undefined);
      await expect(service.getLogs()).rejects.toThrow(ForbiddenException);
    });

    it('delegates to the resolved provider, no local persistence', async () => {
      const logs = [
        {
          messageId: 'msg-1',
          recipient: '+1',
          message: 'Hi',
          status: 'Delivered',
          type: 'generic',
          sentAt: '2026-07-18 10:00:00',
        },
      ];
      mockProvider.getMessageHistory.mockResolvedValue(logs);

      const result = await service.getLogs();

      expect(mockProvider.getMessageHistory).toHaveBeenCalled();
      expect(result).toEqual([{ ...logs[0], provider: 'termii' }]);
    });

    it('tags each log entry with the tenant-selected vendor, not a hardcoded one', async () => {
      mockCredentialResolver.resolveConfig.mockResolvedValue({
        providerId: 'twilio',
        credentials: {
          accountSid: 'AC1',
          authToken: 'secret',
          fromNumber: '+1000',
        },
      });
      mockProvider.getMessageHistory.mockResolvedValue([
        {
          messageId: 'msg-2',
          recipient: '+1',
          message: 'Hi',
          status: 'delivered',
          type: 'generic',
          sentAt: '2026-07-18 10:00:00',
        },
      ]);

      const result = await service.getLogs();

      expect(result[0].provider).toBe('twilio');
    });
  });
});
