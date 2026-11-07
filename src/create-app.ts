import type { LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule, type AppModuleOptions } from './app.module.js';

/**
 * Dựng app (dùng chung cho main.ts và test e2e, để test chạy đúng cấu hình như production).
 */
export async function createRegistryApp(
  options: AppModuleOptions,
  logger?: LogLevel[] | false,
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(options), {
    // Tắt body parser mặc định (100kb, nhận cả urlencoded) để tự khai báo: chỉ JSON, giới hạn nhỏ.
    bodyParser: false,
    ...(logger !== undefined && { logger }),
  });
  app.useBodyParser('json', { limit: options.config.bodyLimit });
  // Tắt ETag tự sinh của Express: ETag của snapshot do registry tự tính (bootId-version).
  app.set('etag', false);
  app.set('x-powered-by', false);
  app.enableShutdownHooks();
  return app;
}
