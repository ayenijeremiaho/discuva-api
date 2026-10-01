import {
  Controller,
  Get,
  Res,
  ServiceUnavailableException,
  Version,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService } from './app.service';
import { DataSource } from 'typeorm';
import { CacheService } from './utility/service/cache.service';
import { Public } from './auth/decorator/public.decorator';
import { Response } from 'express';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly dataSource: DataSource,
    private readonly cacheService: CacheService,
  ) {}

  @Public()
  @SkipThrottle()
  @Version(VERSION_NEUTRAL)
  @Get()
  getHomepage(@Res() res: Response): void {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(this.appService.getHomepage());
  }

  @Public()
  @SkipThrottle()
  @Version(VERSION_NEUTRAL)
  @Get('docs')
  redirectDocs(@Res() res: Response): void {
    res.redirect(301, '/');
  }

  // Fly's 30-second check. Deliberately no database query: that alone would keep the database from ever scaling
  // to zero, and restarting the app wouldn't fix a database outage anyway. Use /health/deep to include the database.
  @Public()
  @SkipThrottle()
  @Version(VERSION_NEUTRAL)
  @Get('health')
  async health(): Promise<{ status: string; uptime: number }> {
    const errors: string[] = [];
    await this.cacheService.ping().catch(() => errors.push('redis'));
    if (errors.length) {
      throw new ServiceUnavailableException(
        `Unhealthy: ${errors.join(', ')} unreachable`,
      );
    }
    return { status: 'ok', uptime: Math.floor(process.uptime()) };
  }

  // Also checks the database (waking it if it has scaled to zero) — for manual checks or a low-frequency monitor.
  @Public()
  @SkipThrottle()
  @Version(VERSION_NEUTRAL)
  @Get('health/deep')
  async deepHealth(): Promise<{ status: string; uptime: number }> {
    const errors: string[] = [];

    await this.dataSource
      .query('SELECT 1')
      .catch(() => errors.push('database'));
    await this.cacheService.ping().catch(() => errors.push('redis'));

    if (errors.length) {
      throw new ServiceUnavailableException(
        `Unhealthy: ${errors.join(', ')} unreachable`,
      );
    }

    return { status: 'ok', uptime: Math.floor(process.uptime()) };
  }
}
