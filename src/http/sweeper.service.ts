import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { RegistryStore } from '../registry/registry-store.js';

/**
 * Gọi `store.sweep()` theo nhịp TTL/3. Timer nằm ở đây (lớp framework), KHÔNG nằm trong core:
 * core chỉ có hàm sweep() thuần nên test gọi trực tiếp, không cần timer giả.
 *
 * Store đã gỡ instance hết hạn "lazy" mỗi khi có người hỏi tới project, nên sweeper không quyết định
 * tính đúng; nó dọn các project không ai hỏi tới (giải phóng RAM, log "expired" đúng lúc).
 * Log "expired" nằm ở hook onExpire của store (app.module.ts), để gỡ kiểu nào cũng có log.
 */
@Injectable()
export class SweeperService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;

  constructor(private readonly store: RegistryStore) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => this.store.sweep(), this.store.heartbeatIntervalMs); // = TTL/3
    // unref: timer không giữ process sống. Mọi thứ khác đã tắt thì process thoát được.
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
