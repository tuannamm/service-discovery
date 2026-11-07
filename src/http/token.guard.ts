import { Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { RegistryConfig } from '../config.js';
import { REGISTRY_CONFIG } from './tokens.js';

export const REGISTRY_TOKEN_HEADER = 'x-registry-token';

/**
 * Bảo vệ các lệnh GHI (PUT/DELETE). Ai ghi được vào registry là điều hướng được traffic:
 * đăng ký instance giả giữ pattern "auth.login" là nhận được mật khẩu người dùng.
 * Không đặt REGISTRY_TOKEN thì cho qua (chỉ dùng khi registry nằm trong mạng nội bộ).
 */
@Injectable()
export class TokenGuard implements CanActivate {
  private readonly expected?: Buffer;

  constructor(@Inject(REGISTRY_CONFIG) config: RegistryConfig) {
    this.expected = config.token ? digest(config.token) : undefined;
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.expected) return true;
    const provided = context.switchToHttp().getRequest<Request>().header(REGISTRY_TOKEN_HEADER);
    // So sánh constant-time: `===` dừng ở ký tự sai đầu tiên, đo thời gian phản hồi là đoán dần được token.
    // Băm trước để hai buffer luôn cùng độ dài (timingSafeEqual yêu cầu vậy, và không lộ độ dài token).
    if (!provided || !timingSafeEqual(digest(provided), this.expected)) {
      throw new UnauthorizedException(`Missing or invalid ${REGISTRY_TOKEN_HEADER} header.`);
    }
    return true;
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
