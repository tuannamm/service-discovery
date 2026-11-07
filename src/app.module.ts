import { Logger, Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import type { RegistryConfig } from './config.js';
import { OverviewController } from './http/overview.controller.js';
import { ProblemFilter } from './http/problem.filter.js';
import { RegistryController } from './http/registry.controller.js';
import { SweeperService } from './http/sweeper.service.js';
import { TokenGuard } from './http/token.guard.js';
import { REGISTRY_CONFIG } from './http/tokens.js';
import type { Clock } from './registry/clock.js';
import { RegistryStore } from './registry/registry-store.js';

export interface AppModuleOptions {
  config: RegistryConfig;
  /** Test e2e truyền FakeClock để điều khiển thời gian. */
  clock?: Clock;
}

/**
 * Dynamic module: nhận config ĐÃ ĐỌC (main.ts đọc env trước, sai thì dừng trước khi NestJS chạy).
 * Test e2e truyền config/clock riêng mà không phải đụng process.env.
 */
@Module({})
export class AppModule {
  static forRoot({ config, clock }: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      controllers: [RegistryController, OverviewController],
      providers: [
        { provide: REGISTRY_CONFIG, useValue: config },
        { provide: RegistryStore, useValue: createStore(config, clock) },
        { provide: APP_FILTER, useClass: ProblemFilter },
        TokenGuard,
        SweeperService,
      ],
    };
  }
}

function createStore(config: RegistryConfig, clock?: Clock): RegistryStore {
  const logger = new Logger('Registry');
  return new RegistryStore({
    leaseTtlMs: config.leaseTtlMs,
    clock,
    onExpire: (record) =>
      logger.warn(`expired ${record.id} (no heartbeat for > ${config.leaseTtlMs}ms)`),
  });
}
