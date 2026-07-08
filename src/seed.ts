import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DefaultAdminSeed } from './admin/seed/default-admin.seed';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const seeder = app.get(DefaultAdminSeed);
    await seeder.run();
  } finally {
    await app.close();
  }
}

bootstrap().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
