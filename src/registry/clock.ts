import { performance } from 'node:perf_hooks';

/**
 * Nguồn thời gian của registry, tiêm vào RegistryStore để test "tua" được thời gian
 * thay vì sleep thật (test nhanh và không flaky).
 */
export interface Clock {
  /** Mili giây theo đồng hồ MONOTONIC: chỉ tăng, chỉ dùng để đo khoảng thời gian. */
  now(): number;
}

/**
 * `performance.now()` thay vì `Date.now()`: Date.now() là giờ thực, có thể nhảy khi NTP
 * chỉnh giờ. Giờ nhảy tới 1 phút thì mọi instance bị coi là hết hạn và gỡ oan cùng lúc.
 */
export const systemClock: Clock = {
  now: () => performance.now(),
};

/** Đồng hồ giả cho test. */
export class FakeClock implements Clock {
  constructor(private current = 0) {}

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}
