import { randomUUID } from 'node:crypto';
import { systemClock, type Clock } from './clock.js';
import { PatternConflictError } from './errors.js';
import { validateInstanceId, validateRegistration } from './validation.js';
import type {
  InstanceRecord,
  RegisterResult,
  RegistrationInput,
  Overview,
  OverviewInstance,
  OverviewService,
  Snapshot,
  SnapshotInstance,
} from './types.js';

export interface RegistryStoreOptions {
  /** Lease TTL: quá thời gian này không có heartbeat thì instance bị gỡ. */
  leaseTtlMs: number;
  clock?: Clock;
  /** Mã "thế hệ" của lần khởi động này, đưa vào ETag. Mặc định UUID ngẫu nhiên. */
  bootId?: string;
  /** Giờ thực (epoch ms) cho `registeredAt`. Mặc định Date.now; test truyền hàm cố định. */
  wallClock?: () => number;
  /** Gọi cho MỖI instance bị gỡ vì hết hạn (dù gỡ lazy hay do sweep), để lớp ngoài log. */
  onExpire?: (record: InstanceRecord) => void;
}

/** Ai đang giữ một pattern: một service, có thể nhiều instance của service đó. */
interface PatternOwner {
  service: string;
  ids: Set<string>;
}

/**
 * CORE của registry: lưu in-memory, không biết HTTP, không có timer.
 *
 * Một registry phục vụ MỘT project application, nên không có khái niệm project ở đây: chỉ có
 * MỘT bảng instance. Muốn chạy nhiều project thì chạy nhiều registry.
 *
 * Hết hạn theo hai đường (giống Redis xử lý key có TTL):
 *  - LAZY: mọi thao tác gỡ ngay instance đã hết hạn trước, nên kết quả luôn đúng tại thời điểm
 *    gọi, không phụ thuộc lúc sweeper chạy.
 *  - ĐỊNH KỲ: `sweep()` (lớp HTTP gọi theo nhịp) dọn khi không ai hỏi tới, và để có log.
 */
export class RegistryStore {
  readonly bootId: string;
  readonly leaseTtlMs: number;
  /** Heartbeat = TTL/3: lỡ 2 nhịp (mạng chập chờn, GC pause) vẫn chưa bị gỡ. */
  readonly heartbeatIntervalMs: number;
  private readonly clock: Clock;
  private readonly wallClock: () => number;
  private readonly onExpire?: (record: InstanceRecord) => void;

  /** Chỉ tăng khi bảng đổi; không bao giờ lùi trong một lần chạy. */
  private version = 0;
  private readonly instances = new Map<string, InstanceRecord>();
  /** pattern → chủ. Tính lại mỗi khi bảng đổi, để kiểm tra xung đột O(1). */
  private owners = new Map<string, PatternOwner>();

  constructor(options: RegistryStoreOptions) {
    if (!Number.isFinite(options.leaseTtlMs) || options.leaseTtlMs <= 0) {
      throw new Error('leaseTtlMs must be a positive number.');
    }
    this.leaseTtlMs = options.leaseTtlMs;
    this.heartbeatIntervalMs = Math.max(1, Math.floor(options.leaseTtlMs / 3));
    this.clock = options.clock ?? systemClock;
    this.wallClock = options.wallClock ?? Date.now;
    this.bootId = options.bootId ?? randomUUID();
    this.onExpire = options.onExpire;
  }

  /**
   * Đăng ký HOẶC heartbeat: cùng một lệnh, luôn mang đủ dữ liệu (idempotent).
   * Registry restart mất sạch RAM thì heartbeat kế tiếp tự khôi phục (soft state).
   */
  register(id: string, body: unknown): RegisterResult {
    const input = validateRegistration(id, body);
    this.expire();

    // KIỂM TRA HẾT rồi mới GHI: có xung đột thì không đổi gì cả (không có trạng thái nửa vời).
    const conflicts = this.findConflicts(id, input);
    if (conflicts.length) throw new PatternConflictError(conflicts);

    const previous = this.instances.get(id);
    const now = this.clock.now();
    // registeredAt giữ nguyên qua các lần update: vẫn là cùng một instance (cùng id).
    const registeredAt = previous?.registeredAt ?? this.wallClock();
    const record: InstanceRecord = { ...input, id, lastSeen: now, registeredAt };

    if (previous && sameRegistration(previous, input)) {
      // Heartbeat thuần: chỉ gia hạn, KHÔNG tăng version → gateway poll nhận 304.
      previous.lastSeen = now;
      return this.result('renewed');
    }

    this.instances.set(id, record);
    this.changed();
    return this.result(previous ? 'updated' : 'created');
  }

  /** Huỷ đăng ký. Không tồn tại cũng không lỗi (idempotent). Trả về có gỡ được gì không. */
  deregister(id: string): boolean {
    validateInstanceId(id);
    if (!this.instances.delete(id)) return false;
    this.changed();
    return true;
  }

  /** Gỡ mọi instance hết hạn. Trả về danh sách đã gỡ (để log). */
  sweep(): InstanceRecord[] {
    return this.expire();
  }

  snapshot(): Snapshot {
    this.expire();
    const instances = [...this.instances.values()]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(toSnapshotInstance);
    return { version: this.version, instances };
  }

  /**
   * ETag của snapshot. Kèm bootId: registry restart thì version đếm lại từ 0, nếu ETag chỉ có
   * version thì gateway có thể nhận 304 cho một bảng KHÁC nhưng trùng số version.
   */
  etag(snapshot: Snapshot): string {
    return `"${this.bootId}-${snapshot.version}"`;
  }

  /** Ngưỡng health: heartbeat cũ hơn 1.5 nhịp nghĩa là đã lỡ ít nhất một nhịp. */
  get healthyThresholdMs(): number {
    return Math.floor(this.heartbeatIntervalMs * 1.5);
  }

  /** Toàn cảnh service → instance, kèm health. Chỉ đọc (sau khi gỡ instance hết hạn). */
  overview(): Overview {
    this.expire();
    const now = this.clock.now();
    const byService = new Map<string, OverviewInstance[]>();
    for (const record of this.instances.values()) {
      const list = byService.get(record.service) ?? [];
      list.push(this.toOverviewInstance(record, now));
      byService.set(record.service, list);
    }
    const services: OverviewService[] = [...byService.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([service, instances]) => {
        instances.sort((a, b) => a.id.localeCompare(b.id));
        return {
          service,
          instanceCount: instances.length,
          healthyCount: instances.filter((i) => i.health === 'healthy').length,
          patterns: [...new Set(instances.flatMap((i) => i.patterns))].sort(),
          instances,
        };
      });

    return {
      bootId: this.bootId,
      generatedAt: new Date(this.wallClock()).toISOString(),
      leaseTtlMs: this.leaseTtlMs,
      heartbeatIntervalMs: this.heartbeatIntervalMs,
      healthyThresholdMs: this.healthyThresholdMs,
      version: this.version,
      services,
    };
  }

  // ---------------------------------------------------------------------------

  private expire(): InstanceRecord[] {
    const now = this.clock.now();
    const removed: InstanceRecord[] = [];
    for (const [id, record] of this.instances) {
      if (now - record.lastSeen > this.leaseTtlMs) {
        this.instances.delete(id);
        removed.push(record);
        this.onExpire?.(record);
      }
    }
    if (removed.length) this.changed();
    return removed;
  }

  /**
   * Một pattern chỉ thuộc MỘT service trong registry. Nhiều instance của CÙNG service giữ
   * cùng pattern là bình thường (scale ngang). Bỏ qua chính instance `id` đang đăng ký lại,
   * để một instance đổi tên service của chính nó không tự xung đột với mình.
   */
  private findConflicts(id: string, input: RegistrationInput) {
    const conflicts: Array<{ pattern: string; owner: string }> = [];
    for (const pattern of input.patterns) {
      const owner = this.owners.get(pattern);
      if (!owner || owner.service === input.service) continue;
      const othersHolding = [...owner.ids].some((holder) => holder !== id);
      if (othersHolding) conflicts.push({ pattern, owner: owner.service });
    }
    return conflicts;
  }

  /** Bảng đổi: tăng version và tính lại chủ của từng pattern. */
  private changed(): void {
    this.version += 1;
    this.owners = new Map();
    for (const record of this.instances.values()) {
      for (const pattern of record.patterns) {
        const owner = this.owners.get(pattern) ?? { service: record.service, ids: new Set<string>() };
        owner.ids.add(record.id);
        this.owners.set(pattern, owner);
      }
    }
  }

  private toOverviewInstance(record: InstanceRecord, now: number): OverviewInstance {
    const age = Math.max(0, now - record.lastSeen);
    const instance: OverviewInstance = {
      id: record.id,
      host: record.host,
      port: record.port,
      patterns: [...record.patterns].sort(),
      health: age <= this.healthyThresholdMs ? 'healthy' : 'late',
      lastHeartbeatAgoMs: Math.round(age),
      leaseRemainingMs: Math.max(0, Math.round(this.leaseTtlMs - age)),
      registeredAt: new Date(record.registeredAt).toISOString(),
    };
    if (record.metadata) instance.metadata = { ...record.metadata };
    return instance;
  }

  private result(status: RegisterResult['status']): RegisterResult {
    return { status, leaseTtlMs: this.leaseTtlMs, heartbeatIntervalMs: this.heartbeatIntervalMs };
  }
}

/** Dữ liệu đăng ký có giống hệt lần trước không (thứ tự pattern/metadata không quan trọng). */
function sameRegistration(a: RegistrationInput, b: RegistrationInput): boolean {
  return (
    a.service === b.service &&
    a.host === b.host &&
    a.port === b.port &&
    sameSet(a.patterns, b.patterns) &&
    canonicalMetadata(a.metadata) === canonicalMetadata(b.metadata)
  );
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

function canonicalMetadata(metadata?: Record<string, string>): string {
  if (!metadata) return '';
  return JSON.stringify(Object.entries(metadata).sort(([x], [y]) => x.localeCompare(y)));
}

function toSnapshotInstance(record: InstanceRecord): SnapshotInstance {
  const instance: SnapshotInstance = {
    id: record.id,
    service: record.service,
    host: record.host,
    port: record.port,
    patterns: [...record.patterns].sort(),
  };
  if (record.metadata) instance.metadata = { ...record.metadata };
  return instance;
}
