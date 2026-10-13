import { AppThrottlerGuard } from './app-throttler.guard';

describe('AppThrottlerGuard', () => {
  const OLD = process.env.FLY_APP_NAME;
  afterEach(() => {
    process.env.FLY_APP_NAME = OLD;
  });

  it('keys rate limits by the visitor, not the proxy in front of the API', async () => {
    process.env.FLY_APP_NAME = 'discuva-api';
    const guard = Object.create(
      AppThrottlerGuard.prototype,
    ) as AppThrottlerGuard;
    const req: Record<string, any> = {
      headers: { 'fly-client-ip': '203.0.113.7' },
      ip: '172.16.0.1',
      ips: [],
    };
    const tracker = await (guard as any).getTracker(req);
    expect(tracker).toBe('ip:203.0.113.7');
    expect(req.rateLimitLabel).toBe('ip:203.0.113.x');
  });
});
