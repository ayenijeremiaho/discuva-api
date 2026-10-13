import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppThrottlerGuard } from './app-throttler.guard';
import { resetRateLimitKeyVerifiers } from './utility/rate-limit-key';

@Controller()
class PingController {
  @Get('ping')
  ping() {
    return { ok: true };
  }
}

// The real guard behind a real HTTP server, the way Fly delivers requests: same socket, different Fly-Client-IP.
describe('rate limits per visitor (integration)', () => {
  let app: INestApplication;
  const ENV = { ...process.env };

  beforeAll(async () => {
    process.env.FLY_APP_NAME = 'discuva-api';
    process.env.JWT_SECRET = 'a'.repeat(40);
    resetRateLimitKeyVerifiers();
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])],
      controllers: [PingController],
      providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    process.env = ENV;
  });

  const remaining = async (headers: Record<string, string>) => {
    const res = await request(app.getHttpServer()).get('/ping').set(headers);
    return Number(res.headers['x-ratelimit-remaining']);
  };

  it('gives two visitors arriving through the same proxy their own allowance', async () => {
    expect(await remaining({ 'Fly-Client-IP': '102.212.253.9' })).toBe(99);
    expect(await remaining({ 'Fly-Client-IP': '102.212.253.9' })).toBe(98);
    expect(await remaining({ 'Fly-Client-IP': '41.58.1.20' })).toBe(99);
  });

  it('gives two signed-in members on the same church Wi-Fi their own allowance', async () => {
    const token = (sub: string) =>
      `Bearer ${new JwtService({ secret: 'a'.repeat(40) }).sign({ sub, tenantId: 't1' })}`;
    const wifi = { 'Fly-Client-IP': '197.210.5.5' };
    expect(await remaining({ ...wifi, Authorization: token('ada') })).toBe(99);
    expect(await remaining({ ...wifi, Authorization: token('ada') })).toBe(98);
    expect(await remaining({ ...wifi, Authorization: token('ben') })).toBe(99);
    expect(await remaining(wifi)).toBe(99);
  });
});
