import { InternalServerErrorException } from '@nestjs/common';
import { TwilioSmsProvider } from './twilio-sms.provider';

describe('TwilioSmsProvider', () => {
  let provider: TwilioSmsProvider;
  const credentials = {
    accountSid: 'AC123',
    authToken: 'secret',
    fromNumber: '+10000000000',
  };

  beforeEach(() => {
    provider = new TwilioSmsProvider();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('send', () => {
    it('issues one POST per recipient and joins the returned sids', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ sid: 'SM1', status: 'queued' }),
      } as any);

      const result = await provider.send(
        ['+1', '+2'],
        'Hi',
        'plain',
        credentials,
      );

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe(
        'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json',
      );
      expect((options as any).headers.Authorization).toBe(
        `Basic ${Buffer.from('AC123:secret').toString('base64')}`,
      );
      expect(result.messageId).toBe('SM1,SM1');
      expect(result.status).toBe('queued');
    });

    it('throws when any recipient in the batch fails', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ sid: 'SM1', status: 'queued' }),
        } as any)
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({ message: 'Invalid number' }),
        } as any);

      await expect(
        provider.send(['+1', '+2'], 'Hi', 'plain', credentials),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('rejects a batch larger than the per-request recipient limit', async () => {
      const tooMany = Array.from(
        { length: provider.maxRecipientsPerRequest + 1 },
        (_, i) => `+${i}`,
      );
      await expect(
        provider.send(tooMany, 'Hi', 'plain', credentials),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('getBalance', () => {
    it('parses the balance response', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ balance: '12.50', currency: 'USD' }),
      } as any);

      const result = await provider.getBalance(credentials);

      expect(result).toEqual({ balance: 12.5, currency: 'USD' });
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
    it('maps Twilio raw fields to the canonical SmsLogEntry shape', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            messages: [
              {
                sid: 'SM1',
                to: '+1',
                body: 'Hi',
                status: 'delivered',
                direction: 'outbound-api',
                date_sent: '2026-07-18T10:00:00Z',
                from: '+10000000000',
              },
            ],
          }),
      } as any);

      const result = await provider.getMessageHistory(credentials);

      expect(result).toEqual([
        {
          messageId: 'SM1',
          recipient: '+1',
          message: 'Hi',
          status: 'delivered',
          type: 'outbound-api',
          sentAt: '2026-07-18T10:00:00Z',
          sender: '+10000000000',
        },
      ]);
    });

    it('returns an empty array when Twilio responds with no messages field', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      } as any);

      const result = await provider.getMessageHistory(credentials);

      expect(result).toEqual([]);
    });
  });
});
