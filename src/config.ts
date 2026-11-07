/**
 * Cấu hình registry, đọc từ env. Nhận `env` làm tham số (thay vì đọc thẳng process.env)
 * để test truyền giá trị giả. Sai thì ném lỗi → main.ts dừng process (fail-fast).
 */
export interface RegistryConfig {
  port: number;
  leaseTtlMs: number;
  /** Rỗng = không kiểm tra token (chỉ nên dùng khi registry nằm trong mạng nội bộ). */
  token?: string;
  /** Kích thước body tối đa của request đăng ký. */
  bodyLimit: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const DEFAULT_PORT = 8500;
const DEFAULT_LEASE_TTL_MS = 15_000;
/** TTL dưới 1s thì heartbeat (TTL/3) dày tới mức tự tạo tải cho registry. */
const MIN_LEASE_TTL_MS = 1_000;
const MIN_TOKEN_LENGTH = 16;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RegistryConfig {
  const token = env.REGISTRY_TOKEN?.trim() || undefined;
  if (token && token.length < MIN_TOKEN_LENGTH) {
    throw new ConfigError(`REGISTRY_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters.`);
  }
  return {
    port: integer(env, 'PORT', DEFAULT_PORT, 1, 65_535),
    leaseTtlMs: integer(env, 'REGISTRY_LEASE_TTL_MS', DEFAULT_LEASE_TTL_MS, MIN_LEASE_TTL_MS, 3_600_000),
    token,
    bodyLimit: '64kb',
  };
}

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < min || value > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max}, got "${raw}".`);
  }
  return value;
}
