import { Body, Controller, Delete, Get, Headers, HttpCode, Logger, Param, Put, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { RegistryStore } from '../registry/registry-store.js';
import type { RegisterResult } from '../registry/types.js';
import { TokenGuard } from './token.guard.js';

/**
 * Lớp HTTP MỎNG: chỉ dịch HTTP ↔ RegistryStore. Mọi quy tắc nằm trong store (test không cần HTTP).
 */
@Controller()
export class RegistryController {
  private readonly logger = new Logger('Registry');

  constructor(private readonly store: RegistryStore) {}

  /**
   * Đăng ký HOẶC heartbeat. PUT vì client tự chọn id và gọi lại nhiều lần cho cùng kết quả (idempotent).
   */
  @Put('v1/instances/:id')
  @UseGuards(TokenGuard)
  register(@Param('id') id: string, @Body() body: unknown): RegisterResult {
    const result = this.store.register(id, body);
    // Heartbeat ("renewed") đến mỗi 5s từ mọi instance: không log, nếu không log ngập.
    if (result.status !== 'renewed') {
      const b = body as { service: string; host: string; port: number; patterns: string[] };
      this.logger.log(
        `${result.status} ${id} (${b.service} @ ${b.host}:${b.port}, ${b.patterns.length} pattern(s))`,
      );
    }
    return result;
  }

  /** Huỷ đăng ký. 204 kể cả khi không tồn tại: service tắt có thể gọi lại mà không lỗi. */
  @Delete('v1/instances/:id')
  @UseGuards(TokenGuard)
  @HttpCode(204)
  deregister(@Param('id') id: string): void {
    if (this.store.deregister(id)) this.logger.log(`deregistered ${id}`);
  }

  /**
   * Bảng instance của registry, kèm ETag. Gateway gửi lại ETag trong If-None-Match:
   * bảng chưa đổi → 304 không body (phần lớn lần poll chỉ tốn một response rỗng).
   * Dùng @Res() để tự quyết 200 hay 304.
   */
  @Get('v1/snapshot')
  snapshot(@Headers('if-none-match') ifNoneMatch: string | undefined, @Res() res: Response): void {
    const snapshot = this.store.snapshot();
    const etag = this.store.etag(snapshot);
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');
    if (matchesEtag(ifNoneMatch, etag)) {
      res.status(304).end();
      return;
    }
    res.status(200).json(snapshot);
  }

  /** Liveness: process còn trả lời được. */
  @Get('health')
  health(): { status: 'ok'; bootId: string } {
    return { status: 'ok', bootId: this.store.bootId };
  }
}

/**
 * If-None-Match có thể là `*`, một ETag, hay danh sách `"a", W/"b"`. So sánh yếu (bỏ `W/`)
 * như RFC 9110 quy định cho If-None-Match.
 */
export function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  const strip = (tag: string) => tag.trim().replace(/^W\//, '');
  return header.split(',').some((tag) => strip(tag) === strip(etag));
}
