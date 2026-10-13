import { serializeRequest } from './request-log';

describe('serializeRequest', () => {
  it("logs the address rate limits key on today beside Fly's view of the visitor", () => {
    const line = serializeRequest({
      id: 7,
      method: 'GET',
      url: '/v1/events/public/x',
      query: {},
      headers: {
        'user-agent': 'node',
        'fly-client-ip': '203.0.113.7',
        'x-forwarded-for': '203.0.113.7, 172.16.0.2',
      },
      remoteAddress: '172.16.0.2',
      raw: { ip: '172.16.0.2' },
    });
    expect(line).toMatchObject({
      'rate-limit-key': '172.16.0.2',
      'fly-client-ip': '203.0.113.7',
      'x-forwarded-for': '203.0.113.7, 172.16.0.2',
      'user-agent': 'node',
    });
  });

  it('never logs credentials or bodies', () => {
    const line = serializeRequest({
      headers: {
        authorization: 'Bearer secret',
        cookie: 'refresh_token=secret',
        'x-internal-key': 'secret',
      },
    });
    expect(JSON.stringify(line)).not.toContain('secret');
  });

  it('falls back to the socket address when Express has not set req.ip', () => {
    expect(
      serializeRequest({ remoteAddress: '10.0.0.5' })['rate-limit-key'],
    ).toBe('10.0.0.5');
  });
});
