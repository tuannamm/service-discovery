/**
 * Kiểu dữ liệu của registry. File này không import gì: core (`registry/`) không phụ thuộc NestJS,
 * nên sau này đổi framework HTTP hay viết CLI dùng lại store đều được.
 */

/** Body service gửi lên khi `PUT /v1/instances/:id` (đăng ký hoặc heartbeat). */
export interface RegistrationInput {
  /** Tên service, dùng cho log/metrics và để kiểm tra xung đột pattern. Gateway KHÔNG định tuyến theo tên. */
  service: string;
  /** Advertise host: địa chỉ bên khác dùng để gọi tới. Không bao giờ là 0.0.0.0. */
  host: string;
  /** Cổng TCP của microservice. */
  port: number;
  /** Các `@MessagePattern` service xử lý (= operationId trong spec của gateway). */
  patterns: string[];
  metadata?: Record<string, string>;
}

/** Bản ghi registry giữ trong RAM. */
export interface InstanceRecord extends RegistrationInput {
  id: string;
  /**
   * Lần cuối nhận đăng ký/heartbeat, đo bằng đồng hồ MONOTONIC của registry
   * (không tin thời gian service gửi lên, không dùng Date.now() vì có thể nhảy).
   */
  lastSeen: number;
  /** Lần đầu đăng ký, theo GIỜ THỰC (epoch ms). Chỉ để hiển thị, không dùng tính TTL. */
  registeredAt: number;
}

/** Một instance trong snapshot gửi cho gateway. */
export interface SnapshotInstance {
  id: string;
  service: string;
  host: string;
  port: number;
  patterns: string[];
  metadata?: Record<string, string>;
}

/** Kết quả `GET /v1/snapshot`. */
export interface Snapshot {
  /** Chỉ tăng khi bảng đổi. Heartbeat thuần không làm tăng. */
  version: number;
  instances: SnapshotInstance[];
}

/** Kết quả `register()`: cho biết lần gọi này là đăng ký mới, đổi dữ liệu hay chỉ gia hạn. */
export interface RegisterResult {
  status: 'created' | 'updated' | 'renewed';
  leaseTtlMs: number;
  heartbeatIntervalMs: number;
}

/**
 * Health suy ra THỤ ĐỘNG từ tuổi của heartbeat cuối (registry không tự gọi tới service):
 * - healthy: heartbeat cách đây ≤ 1.5 nhịp.
 * - late: đã lỡ ít nhất một nhịp, chưa hết TTL (sắp bị gỡ nếu không heartbeat kịp).
 * Hết TTL thì instance đã bị gỡ, không còn xuất hiện.
 */
export type InstanceHealth = 'healthy' | 'late';

export interface OverviewInstance {
  id: string;
  host: string;
  port: number;
  patterns: string[];
  metadata?: Record<string, string>;
  health: InstanceHealth;
  lastHeartbeatAgoMs: number;
  leaseRemainingMs: number;
  /** ISO 8601 (UTC). */
  registeredAt: string;
}

export interface OverviewService {
  service: string;
  instanceCount: number;
  healthyCount: number;
  /** Hợp các pattern của mọi instance trong service. */
  patterns: string[];
  instances: OverviewInstance[];
}

/** Toàn cảnh registry cho trang /lists và GET /v1/overview. */
export interface Overview {
  bootId: string;
  /** ISO 8601 (UTC). */
  generatedAt: string;
  leaseTtlMs: number;
  heartbeatIntervalMs: number;
  /** Heartbeat cũ hơn ngưỡng này thì instance bị coi là "late". */
  healthyThresholdMs: number;
  /** Version của bảng (cùng số với snapshot): chỉ tăng khi bảng đổi. */
  version: number;
  services: OverviewService[];
}
