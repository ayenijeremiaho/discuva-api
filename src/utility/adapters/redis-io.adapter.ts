import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { INestApplicationContext } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';

interface RedisOptions {
  host: string;
  port: number;
  password?: string;
  db?: number;
  tls?: boolean;
}

export class RedisIoAdapter extends IoAdapter {
  private readonly pubClient: Redis;
  private readonly subClient: Redis;

  constructor(app: INestApplicationContext, options: RedisOptions) {
    super(app);
    const { tls, ...rest } = options;
    this.pubClient = new Redis({ ...rest, ...(tls && { tls: {} }) });
    this.subClient = this.pubClient.duplicate();
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    server.adapter(createAdapter(this.pubClient, this.subClient));
    return server;
  }
}
