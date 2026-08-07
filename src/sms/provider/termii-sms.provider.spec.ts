import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException } from '@nestjs/common';
import { TermiiSmsProvider } from './termii-sms.provider';

describe('TermiiSmsProvider', () => {
  let provider: TermiiSmsProvider;
  const credentials = { apiKey: 'tenant-key', senderId: 'TenantChurch' };
  const mockConfigService = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        TERMII_BASE_URL: 'https://api.ng.termii.com',
      };
      return values[key];
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TermiiSmsProvider,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    provider = module.get<TermiiSmsProvider>(TermiiSmsProvider);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('send', () => {
    it('calls the single-send endpoint for one recipient', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ code: 'ok', message_id: 'abc', message: 'Sent' }),
      } as any);

      const result = await provider.send(
        ['+2348012345678'],
        'Hi',
        'plain',
        credentials,
      );

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.ng.termii.com/api/sms/send');
      const body = JSON.parse((options as any).body);
      expect(body.to).toBe('+2348012345678');
      expect(result).toEqual({ messageId: 'abc', status: 'Sent' });
    });

    it('calls the bulk-send endpoint for multiple recipients', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ code: 'ok', message_id: 'abc' }),
      } as any);

      await provider.send(['+1', '+2'], 'Hi', 'plain', credentials);

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.ng.termii.com/api/sms/send/bulk');
      const body = JSON.parse((options as any).body);
      expect(body.to).toEqual(['+1', '+2']);
    });

    it('throws when Termii responds with a non-ok code', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ code: 'error', message: 'Insufficient balance' }),
      } as any);

      await expect(
        provider.send(['+1'], 'Hi', 'plain', credentials),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('rejects a batch larger than the per-request recipient limit', async () => {
      const tooMany = Array.from({ length: 101 }, (_, i) => `+${i}`);
      await expect(
        provider.send(tooMany, 'Hi', 'plain', credentials),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it("sends with the tenant's own BYOK credentials", async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ code: 'ok', message_id: 'abc' }),
      } as any);

      await provider.send(['+1'], 'Hi', 'plain', {
        apiKey: 'tenant-own-key',
        senderId: 'TenantChurch',
      });

      const [, options] = fetchSpy.mock.calls[0];
      const body = JSON.parse((options as any).body);
      expect(body.api_key).toBe('tenant-own-key');
      expect(body.from).toBe('TenantChurch');
    });
  });

  describe('getBalance', () => {
    it('parses the balance response', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ balance: 785.57, currency: 'NGN' }),
      } as any);

      const result = await provider.getBalance(credentials);

      expect(result).toEqual({ balance: 785.57, currency: 'NGN' });
    });

    it('throws when the balance request fails', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({}),
      } as any);

      await expect(provider.getBalance(credentials)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('getMessageHistory', () => {
    it('maps Termii raw fields to the canonical SmsLogEntry shape', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              receiver: '+2348012345678',
              message: 'Hi there',
              status: 'Delivered',
              sms_type: 'generic',
              message_id: 'msg-1',
              created_at: '2026-07-18 10:00:00',
              sender: 'TestChurch',
            },
          ]),
      } as any);

      const result = await provider.getMessageHistory(credentials);

      expect(result).toEqual([
        {
          messageId: 'msg-1',
          recipient: '+2348012345678',
          message: 'Hi there',
          status: 'Delivered',
          type: 'generic',
          sentAt: '2026-07-18 10:00:00',
          sender: 'TestChurch',
        },
      ]);
    });

    it('returns an empty array when Termii responds with a non-array body', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ unexpected: 'shape' }),
      } as any);

      const result = await provider.getMessageHistory(credentials);

      expect(result).toEqual([]);
    });

    it('throws when the history request fails', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({}),
      } as any);

      await expect(provider.getMessageHistory(credentials)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});
