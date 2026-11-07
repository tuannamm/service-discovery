import { existsSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { loadConfig, type RegistryConfig } from './config.js';
import { createRegistryApp } from './create-app.js';

// Chạy local: nạp .env nếu có. Biến môi trường thật (export, Docker) luôn thắng.
if (existsSync('.env')) process.loadEnvFile('.env');

const logger = new Logger('Registry');

let config: RegistryConfig;
try {
  // Fail-fast: cấu hình sai thì dừng NGAY, không mở cổng.
  config = loadConfig();
} catch (error) {
  logger.error((error as Error).message);
  process.exit(1);
}

const app = await createRegistryApp({ config });
await app.listen(config.port, '0.0.0.0');
logger.log(
  `Listening on http://localhost:${config.port} (lease TTL ${config.leaseTtlMs}ms, ` +
    `token ${config.token ? 'required' : 'NOT required'})`,
);
