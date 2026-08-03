import { Test, TestingModule } from '@nestjs/testing';
import { SmsService } from './sms.service';
import { SMS_PROVIDER } from '../interface/sms-provider.interface';
import { TERMII_MAX_RECIPIENTS_PER_REQUEST } from '../provider/termii-sms.provider';
import { SmsCredentialResolverService } from '../../communication-provider/service/sms-credential-resolver.service';

describe('SmsService', () => {
  let service: SmsService;
  const mockProvider = {
    send: jest.fn(),
    getBalance: jest.fn(),
    getMessageHistory: jest.fn(),
  };
  // No BYOK configured by default — matches the common case, exercised by
  // most of these tests: resolveCredentials() -> undefined means "use the
  // platform default", which is what routes every send through debitForSend().
  const mockCredentialResolver = {
    resolveCredentials: jest.fn().mockResolvedValue(undefined),
    debitForSend: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCredentialResolver.resolveCredentials.mockResolvedValue(undefined);
    mockCredentialResolver.debitForSend.mockResolvedValue(undefined);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmsService,
        { provide: SMS_PROVIDER, useValue: mockProvider },
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
    it('sends a single batch when recipients are within the per-request limit', async () => {
      mockProvider.send.mockResolvedValue({ messageId: '1', status: 'ok' });
      const to = Array.from({ length: 5 }, (_, i) => `+23480000000${i}`);

      const results = await service.send(to, 'Hello');

      expect(mockProvider.send).toHaveBeenCalledTimes(1);
      expect(mockProvider.send).toHaveBeenCalledWith(
        to,
        'Hello',
        'plain',
        undefined,
      );
      expect(results).toHaveLength(1);
    });

    it('debits the wallet by segments × recipients when using the platform default', async () => {
      mockProvider.send.mockResolvedValue({ messageId: '1', status: 'ok' });
      const to = ['+1', '+2', '+3'];

      await service.send(to, 'a'.repeat(161)); // 161 plain chars -> 2 segments

      expect(mockCredentialResolver.debitForSend).toHaveBeenCalledWith(
        6, // 2 segments × 3 recipients
        expect.any(String),
      );
    });

    it("uses the tenant's own BYOK credentials and skips the wallet debit entirely when configured", async () => {
      mockCredentialResolver.resolveCredentials.mockResolvedValue({
        apiKey: 'tenant-key',
        senderId: 'TenantChurch',
      });
      mockProvider.send.mockResolvedValue({ messageId: '1', status: 'ok' });

      await service.send(['+1'], 'Hello');

      expect(mockProvider.send).toHaveBeenCalledWith(['+1'], 'Hello', 'plain', {
        apiKey: 'tenant-key',
        senderId: 'TenantChurch',
      });
      expect(mockCredentialResolver.debitForSend).not.toHaveBeenCalled();
    });

    it('splits recipients into multiple batches over the per-request limit', async () => {
      mockProvider.send.mockResolvedValue({ messageId: '1', status: 'ok' });
      const to = Array.from(
        { length: TERMII_MAX_RECIPIENTS_PER_REQUEST + 10 },
        (_, i) => `+234800000${i}`,
      );

      await service.send(to, 'Hello');

      expect(mockProvider.send).toHaveBeenCalledTimes(2);
      expect(mockProvider.send.mock.calls[0][0]).toHaveLength(
        TERMII_MAX_RECIPIENTS_PER_REQUEST,
      );
      expect(mockProvider.send.mock.calls[1][0]).toHaveLength(10);
    });

    it('does not let one failed batch stop the others', async () => {
      mockProvider.send
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ messageId: '2', status: 'ok' });
      const to = Array.from(
        { length: TERMII_MAX_RECIPIENTS_PER_REQUEST + 1 },
        (_, i) => `+234800000${i}`,
      );

      const results = await service.send(to, 'Hello');

      expect(results).toHaveLength(1);
    });
  });

  describe('getBalance', () => {
    it('delegates to the provider', async () => {
      mockProvider.getBalance.mockResolvedValue({
        balance: 100,
        currency: 'NGN',
      });
      const result = await service.getBalance();
      expect(result).toEqual({ balance: 100, currency: 'NGN' });
    });
  });

  describe('getLogs', () => {
    it('delegates to the provider, no local persistence', async () => {
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
      expect(result).toEqual(logs);
    });
  });
});
