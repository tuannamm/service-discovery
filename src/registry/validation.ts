import { ValidationError } from './errors.js';
import type { RegistrationInput } from './types.js';

/** Tên project/service: chữ thường, số, `-`; bắt đầu bằng chữ/số. Giống tên DNS label. */
export const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** Instance id: rộng hơn một chút để chứa hostname (`echo-my-host.local-4001`). */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const MAX_PATTERNS = 500;
export const MAX_PATTERN_LENGTH = 200;
export const MAX_METADATA_KEYS = 32;
export const MAX_METADATA_VALUE_LENGTH = 256;
export const MAX_HOST_LENGTH = 253;

/** Địa chỉ "mọi card mạng": nghe được, nhưng không ai GỌI TỚI được. */
const UNROUTABLE_HOSTS = new Set(['0.0.0.0', '::', '[::]']);

export function validateProject(project: string): void {
  if (!NAME_PATTERN.test(project)) {
    throw new ValidationError([`"project" must match ${NAME_PATTERN}.`]);
  }
}

export function validateInstanceId(id: string): void {
  if (!ID_PATTERN.test(id)) {
    throw new ValidationError([`"id" must match ${ID_PATTERN}.`]);
  }
}

/**
 * Kiểm tra toàn bộ request đăng ký, gom mọi lỗi rồi ném một lần.
 * Nhận `unknown` vì body đến từ mạng: không được tin kiểu dữ liệu.
 * Trả về bản đã chuẩn hoá (chỉ giữ field đã biết, bỏ field lạ).
 */
export function validateRegistration(project: string, id: string, body: unknown): RegistrationInput {
  const issues: string[] = [];
  if (!NAME_PATTERN.test(project)) issues.push(`"project" must match ${NAME_PATTERN}.`);
  if (!ID_PATTERN.test(id)) issues.push(`"id" must match ${ID_PATTERN}.`);

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ValidationError([...issues, 'Body must be a JSON object.']);
  }
  const b = body as Record<string, unknown>;

  if (typeof b.service !== 'string' || !NAME_PATTERN.test(b.service)) {
    issues.push(`"service" must be a string matching ${NAME_PATTERN}.`);
  }

  if (typeof b.host !== 'string' || b.host.trim() === '' || b.host.length > MAX_HOST_LENGTH || /\s/.test(b.host)) {
    issues.push(`"host" must be a non-empty string without spaces (max ${MAX_HOST_LENGTH} chars).`);
  } else if (UNROUTABLE_HOSTS.has(b.host)) {
    issues.push(`"host" must be an address other services can reach, not "${b.host}" (set an advertise host).`);
  }

  if (typeof b.port !== 'number' || !Number.isInteger(b.port) || b.port < 1 || b.port > 65_535) {
    issues.push('"port" must be an integer between 1 and 65535.');
  }

  if (!Array.isArray(b.patterns) || b.patterns.length === 0 || b.patterns.length > MAX_PATTERNS) {
    issues.push(`"patterns" must be an array of 1-${MAX_PATTERNS} strings.`);
  } else {
    const seen = new Set<string>();
    b.patterns.forEach((p, i) => {
      if (typeof p !== 'string' || p.trim() === '' || p !== p.trim() || p.length > MAX_PATTERN_LENGTH) {
        issues.push(`"patterns[${i}]" must be a non-empty string without leading/trailing spaces (max ${MAX_PATTERN_LENGTH} chars).`);
      } else if (seen.has(p)) {
        issues.push(`"patterns[${i}]" duplicates "${p}".`);
      } else {
        seen.add(p);
      }
    });
  }

  if (b.metadata !== undefined) {
    const m = b.metadata;
    if (typeof m !== 'object' || m === null || Array.isArray(m)) {
      issues.push('"metadata" must be an object of string values.');
    } else {
      const entries = Object.entries(m);
      if (entries.length > MAX_METADATA_KEYS) issues.push(`"metadata" must have at most ${MAX_METADATA_KEYS} keys.`);
      for (const [key, value] of entries) {
        if (typeof value !== 'string' || value.length > MAX_METADATA_VALUE_LENGTH) {
          issues.push(`"metadata.${key}" must be a string (max ${MAX_METADATA_VALUE_LENGTH} chars).`);
        }
      }
    }
  }

  if (issues.length) throw new ValidationError(issues);

  const input: RegistrationInput = {
    service: b.service as string,
    host: b.host as string,
    port: b.port as number,
    patterns: [...(b.patterns as string[])],
  };
  if (b.metadata !== undefined) input.metadata = { ...(b.metadata as Record<string, string>) };
  return input;
}
