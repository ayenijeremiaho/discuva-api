import { serializeRequest, serializeResponse } from './request-log';

describe('request logs', () => {
  it('records the path and query names only, never query values that carry tokens or searches', () => {
    const line = serializeRequest({
      method: 'POST',
      url: '/v1/service-session/LIVE1/advance?token=share-secret&grantToken=grant-secret',
      query: { token: 'share-secret', grantToken: 'grant-secret' },
      headers: {},
    });
    expect(line.url).toBe('/v1/service-session/LIVE1/advance');
    expect(line['query-keys']).toEqual(['token', 'grantToken']);
    expect(JSON.stringify(line)).not.toContain('secret');

    const search = serializeRequest({
      url: '/v1/members?search=Ada%20Obi',
      query: { search: 'Ada Obi' },
    });
    expect(JSON.stringify(search)).not.toMatch(/Ada/);
  });

  it('shows who rate limits counted against and Fly’s view of the visitor, masked', () => {
    const line = serializeRequest({
      url: '/v1/events/x',
      headers: {
        'user-agent': 'Mozilla/5.0',
        'fly-client-ip': '102.212.253.9',
        'x-forwarded-for': '102.212.253.9, 66.241.124.132',
      },
      raw: { rateLimitLabel: 'ip:102.212.253.x' },
    });
    expect(line).toMatchObject({
      'rate-limit-key': 'ip:102.212.253.x',
      'fly-client-ip': '102.212.253.x',
      'x-forwarded-for': '102.212.253.x, 66.241.124.x',
    });
    expect(JSON.stringify(line)).not.toContain('102.212.253.9');
  });

  it('never logs credentials from request headers', () => {
    const line = serializeRequest({
      headers: {
        authorization: 'Bearer secret',
        cookie: 'refresh_token=secret',
        'x-internal-key': 'secret',
      },
      remoteAddress: '10.0.0.5',
    });
    expect(JSON.stringify(line)).not.toContain('secret');
    expect(line['rate-limit-key']).toBe('ip:10.0.0.x');
  });

  it('drops Set-Cookie and every other response header except a safe few', () => {
    const line = serializeResponse({
      statusCode: 200,
      headers: {
        'set-cookie': ['refresh_token=very-secret; HttpOnly'],
        'content-type': 'application/json',
        'x-ratelimit-remaining': '98',
        'access-control-allow-origin': 'https://church.example',
      },
    });
    expect(line).toEqual({
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
        'x-ratelimit-remaining': '98',
      },
    });
    expect(JSON.stringify(line)).not.toContain('secret');
  });
});
