import './instrument';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './utility/adapters/redis-io.adapter';
import { Logger } from 'nestjs-pino';
import { INestApplication, VersioningType } from '@nestjs/common';
import { HttpExceptionFilter } from './utility/filters/http-exception.filter';
import { TransformInterceptor } from './utility/interceptors/transform.interceptor';
import { TrimValidationPipe } from './utility/pipes/trim-validation.pipe';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { ExpressAdapter as BullBoardExpressAdapter } from '@bull-board/express';
import { getQueueToken } from '@nestjs/bull';
import { Queue } from 'bull';
import { Request, Response, NextFunction } from 'express';
import { createCorsOriginValidator } from './tenant/utility/cors-origin-validator';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
  mountBullBoard(app);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: [],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(cookieParser());
  app.useWebSocketAdapter(
    new RedisIoAdapter(app, {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number.parseInt(process.env.REDIS_PORT ?? '6379'),
      password: process.env.REDIS_PASSWORD || undefined,
      db: Number.parseInt(process.env.REDIS_DB ?? '0'),
      tls: process.env.REDIS_TLS === 'true',
    }),
  );
  app.enableCors(corsOptions());
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  registerNestLogger(app);
  registerGlobalPipes(app);
  registerGlobalFilters(app);
  registerGlobalInterceptors(app);
  await app.listen(process.env.PORT ?? 3000);
}

function registerNestLogger(app: INestApplication) {
  app.useLogger(app.get(Logger));
}

function registerGlobalPipes(app: INestApplication) {
  app.useGlobalPipes(
    new TrimValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}

function registerGlobalFilters(app: INestApplication) {
  app.useGlobalFilters(new HttpExceptionFilter());
}

function registerGlobalInterceptors(app: INestApplication) {
  app.useGlobalInterceptors(new TransformInterceptor());
}

function corsOptions() {
  return {
    origin: createCorsOriginValidator(),
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    preflightContinue: false,
  };
}

bootstrap();

function mountBullBoard(app: INestApplication) {
  const user = process.env.BULL_BOARD_USER;
  const password = process.env.BULL_BOARD_PASSWORD;
  if (!user || !password) return;

  const serverAdapter = new BullBoardExpressAdapter();
  serverAdapter.setBasePath('/queues');

  createBullBoard({
    queues: [
      new BullAdapter(app.get<Queue>(getQueueToken('email'))),
      new BullAdapter(app.get<Queue>(getQueueToken('push-notifications'))),
      new BullAdapter(app.get<Queue>(getQueueToken('follow-up'))),
      new BullAdapter(app.get<Queue>(getQueueToken('tithe'))),
      new BullAdapter(app.get<Queue>(getQueueToken('finance-reconciliation'))),
      new BullAdapter(app.get<Queue>(getQueueToken('audit-log'))),
    ],
    serverAdapter,
  });

  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use(
    '/queues',
    bullBasicAuth(user, password),
    serverAdapter.getRouter(),
  );
}

function bullBasicAuth(user: string, password: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = req.headers['authorization'];
    if (!auth?.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
      return res.status(401).send('Authentication required');
    }
    const decoded = Buffer.from(auth.slice(6), 'base64').toString();
    const colonIdx = decoded.indexOf(':');
    const u = decoded.slice(0, colonIdx);
    const p = decoded.slice(colonIdx + 1);
    if (u !== user || p !== password) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
      return res.status(401).send('Invalid credentials');
    }
    next();
  };
}
