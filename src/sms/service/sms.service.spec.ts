import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SmsService } from './sms.service';
import { SmsProviderRegistryService } from './sms-provider-registry.service';
import { SmsCredentialResolverService } from '../../communication-provider/service/sms-credential-resolver.service';
import { SmsDeliveryLog } from '../entity/sms-delivery-log.entity';

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
  const mockDeliveryLogRepo = {
    create: jest.fn((values) => ({
      ...values,
      id: 'log-1',
      createdAt: new Date(),
    })),
    save: jest.fn((logs) => Promise.resolve(logs)),
    find: jest.fn().mockResolvedValue([]),
  };
  const mockConfigService = { get: jest.fn().mockReturnValue('en-NG') };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRegistry.get.mockReturnValue(mockProvider);
    mockCredentialResolver.resolveConfig.mockResolvedValue({
      providerId: 'termii',
      credentials: { apiKey: 'tenant-key', senderId: 'TenantChurch' },
    });
    mockDeliveryLogRepo.create.mockImplementation((values) => ({
      ...values,
      id: 'log-1',
      createdAt: new Date(),
    }));
    mockDeliveryLogRepo.save.mockImplementation((logs) =>
      Promise.resolve(logs),
    );
    mockDeliveryLogRepo.find.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmsService,
        { provide: SmsProviderRegistryService, useValue: mockRegistry },
        {
          provide: SmsCredentialResolverService,
          useValue: mockCredentialResolver,
        },
        {
          provide: getRepositoryToken(SmsDeliveryLog),
          useValue: mockDeliveryLogRepo,
        },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = module.get<SmsService>(SmsService);
  });

  afterEach(() => {
    jest.useRealTimers();
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
      jest.useFakeTimers().setSystemTime(new Date('2026-09-27T07:00:00.000Z'));
      mockCredentialResolver.resolveConfig.mockResolvedValue(undefined);

      await expect(service.send(['+2348012345678'], 'Hello')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockProvider.send).not.toHaveBeenCalled();
    });

    it('dispatches to the provider resolved from the registry by providerId', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-27T07:00:00.000Z'));
      mockProvider.send.mockResolvedValue({ messageId: '1', status: 'ok' });
      const to = Array.from(
        { length: 5 },
        (_, i) => `+234801234${String(i).padStart(4, '0')}`,
      );

      const results = await service.send(to, 'Hello');

      expect(mockRegistry.get).toHaveBeenCalledWith('termii');
      expect(mockProvider.send).toHaveBeenCalledTimes(1);
      expect(mockProvider.send).toHaveBeenCalledWith(to, 'Hello', 'plain', {
        apiKey: 'tenant-key',
        senderId: 'TenantChurch',
      });
      expect(results).toEqual({
        acceptedCount: 5,
        failedCount: 0,
        failures: [],
      });
      expect(mockDeliveryLogRepo.save).toHaveBeenCalledTimes(2);
    });

    it('normalizes national-format numbers to E.164 before provider dispatch', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-27T07:00:00.000Z'));
      mockProvider.send.mockResolvedValue({ messageId: '1', status: 'ok' });

      await service.send(['08012345678'], 'Hello');

      expect(mockProvider.send).toHaveBeenCalledWith(
        ['+2348012345678'],
        'Hello',
        'plain',
        { apiKey: 'tenant-key', senderId: 'TenantChurch' },
      );
      expect(mockDeliveryLogRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ recipient: '+2348012345678' }),
      );
    });

    it('sends once when the same number appears in local and E.164 form', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-27T07:00:00.000Z'));
      mockProvider.send.mockResolvedValue({ messageId: '1', status: 'ok' });

      const result = await service.send(
        ['08012345678', '+2348012345678'],
        'Hello',
      );

      expect(mockProvider.send).toHaveBeenCalledWith(
        ['+2348012345678'],
        'Hello',
        'plain',
        { apiKey: 'tenant-key', senderId: 'TenantChurch' },
      );
      expect(result.acceptedCount).toBe(1);
    });

    it('records invalid recipient numbers as failures without contacting the provider', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-27T07:00:00.000Z'));

      const result = await service.send(['07012'], 'Hello');

      expect(result.acceptedCount).toBe(0);
      expect(result.failedCount).toBe(1);
      expect(mockProvider.send).not.toHaveBeenCalled();
      expect(mockDeliveryLogRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          recipient: '07012',
          status: 'FAILED',
          errorMessage: expect.stringContaining('invalid'),
        }),
      );
    });

    it('routes to the tenant-selected vendor, not a hardcoded one', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-27T07:00:00.000Z'));
      mockCredentialResolver.resolveConfig.mockResolvedValue({
        providerId: 'twilio',
        credentials: {
          accountSid: 'AC1',
          authToken: 'secret',
          fromNumber: '+10000000000',
        },
      });
      mockProvider.send.mockResolvedValue({ messageId: '1', status: 'ok' });

      await service.send(['+2348012345678'], 'Hello');

      expect(mockRegistry.get).toHaveBeenCalledWith('twilio');
    });

    it('splits recipients into multiple batches using the resolved provider max', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-27T07:00:00.000Z'));
      mockProvider.maxRecipientsPerRequest = 100;
      mockProvider.send.mockResolvedValue({ messageId: '1', status: 'ok' });
      const to = Array.from(
        { length: mockProvider.maxRecipientsPerRequest + 10 },
        (_, i) => `+234801234${String(i).padStart(4, '0')}`,
      );

      await service.send(to, 'Hello');

      expect(mockProvider.send).toHaveBeenCalledTimes(2);
      expect(mockProvider.send.mock.calls[0][0]).toHaveLength(
        mockProvider.maxRecipientsPerRequest,
      );
      expect(mockProvider.send.mock.calls[1][0]).toHaveLength(10);
    });

    it('continues remaining batches but rejects when a provider batch fails', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-27T07:00:00.000Z'));
      mockProvider.maxRecipientsPerRequest = 100;
      mockProvider.send
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ messageId: '2', status: 'ok' });
      const to = Array.from(
        { length: mockProvider.maxRecipientsPerRequest + 1 },
        (_, i) => `+234801234${String(i).padStart(4, '0')}`,
      );

      const outcome = await service.send(to, 'Hello');

      expect(mockProvider.send).toHaveBeenCalledTimes(2);
      expect(outcome).toEqual({
        acceptedCount: 1,
        failedCount: 100,
        failures: ['boom'],
      });
      expect(mockDeliveryLogRepo.save).toHaveBeenCalledTimes(4);
      expect(mockDeliveryLogRepo.save.mock.calls[1][0][0]).toMatchObject({
        status: 'FAILED',
        errorMessage: 'boom',
      });
    });

    it('records sends attempted before 8:00am without calling a provider', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-27T06:59:00.000Z'));

      const outcome = await service.send(['+2348012345678'], 'Hello');

      expect(outcome).toEqual({
        acceptedCount: 0,
        failedCount: 1,
        failures: [
          'SMS sending is available from 8:00am to 7:50pm (Africa/Lagos).',
        ],
      });
      expect(mockCredentialResolver.resolveConfig).toHaveBeenCalled();
      expect(mockProvider.send).not.toHaveBeenCalled();
      expect(mockDeliveryLogRepo.save).toHaveBeenCalledTimes(2);
    });

    it('records sends after 7:50pm without calling a provider', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-27T18:51:00.000Z'));

      const outcome = await service.send(['+2348012345678'], 'Hello');

      expect(outcome.failedCount).toBe(1);
      expect(outcome.failures[0]).toContain('8:00am to 7:50pm');
      expect(mockProvider.send).not.toHaveBeenCalled();
      expect(mockDeliveryLogRepo.save).toHaveBeenCalledTimes(2);
    });

    it('allows sends through 7:50pm in the configured timezone', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-27T18:50:00.000Z'));
      mockProvider.send.mockResolvedValue({ messageId: '1', status: 'ok' });

      await service.send(['+2348012345678'], 'Hello');

      expect(mockProvider.send).toHaveBeenCalledTimes(1);
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

    it('merges provider history with matching local dispatch metadata', async () => {
      const logs = [
        {
          messageId: 'msg-1',
          recipient: '+2348012345678',
          message: 'Hi',
          status: 'Delivered',
          type: 'generic',
          sentAt: '2026-07-18 10:00:00',
        },
      ];
      mockProvider.getMessageHistory.mockResolvedValue(logs);
      mockDeliveryLogRepo.find.mockResolvedValue([
        {
          id: 'dispatch-1',
          provider: 'termii',
          providerMessageId: 'msg-1',
          recipient: '+2348012345678',
          message: 'Hi',
          status: 'ACCEPTED',
          providerStatus: 'Successfully Sent',
          errorMessage: null,
          sourceType: 'announcement',
          sourceId: 'announcement-1',
          sourceLabel: 'Service reminder',
          createdAt: new Date('2026-07-18T10:00:00Z'),
        },
      ]);

      const result = await service.getLogs();

      expect(mockProvider.getMessageHistory).toHaveBeenCalled();
      expect(mockDeliveryLogRepo.find).toHaveBeenCalledWith({
        where: { provider: 'termii' },
        order: { createdAt: 'DESC' },
        take: 500,
      });
      expect(result).toEqual([
        {
          ...logs[0],
          provider: 'termii',
          dispatchStatus: 'ACCEPTED',
          errorMessage: undefined,
          sourceType: 'announcement',
          sourceId: 'announcement-1',
          sourceLabel: 'Service reminder',
          trackingId: 'dispatch-1',
        },
      ]);
    });

    it('returns locally tracked failures when no provider message ID exists', async () => {
      mockProvider.getMessageHistory.mockRejectedValue(
        new Error('history temporarily unavailable'),
      );
      mockDeliveryLogRepo.find.mockResolvedValue([
        {
          id: 'dispatch-failed',
          provider: 'termii',
          providerMessageId: null,
          recipient: '+2348012345678',
          message: 'Announcement message',
          status: 'FAILED',
          providerStatus: null,
          errorMessage: 'Termii DND route is not enabled',
          sourceType: 'announcement',
          sourceId: 'announcement-1',
          sourceLabel: 'Sunday Service',
          createdAt: new Date('2026-09-28T15:16:19.700Z'),
        },
      ]);

      const result = await service.getLogs();

      expect(result).toEqual([
        {
          messageId: 'dispatch-failed',
          recipient: '+2348012345678',
          message: 'Announcement message',
          status: 'FAILED',
          type: 'sms',
          sentAt: '2026-09-28T15:16:19.700Z',
          provider: 'termii',
          dispatchStatus: 'FAILED',
          errorMessage: 'Termii DND route is not enabled',
          sourceType: 'announcement',
          sourceId: 'announcement-1',
          sourceLabel: 'Sunday Service',
          trackingId: 'dispatch-failed',
        },
      ]);
    });

    it('tags each log entry with the tenant-selected vendor, not a hardcoded one', async () => {
      mockCredentialResolver.resolveConfig.mockResolvedValue({
        providerId: 'twilio',
        credentials: {
          accountSid: 'AC1',
          authToken: 'secret',
          fromNumber: '+10000000000',
        },
      });
      mockProvider.getMessageHistory.mockResolvedValue([
        {
          messageId: 'msg-2',
          recipient: '+2348012345678',
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
