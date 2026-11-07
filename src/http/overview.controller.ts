import { Controller, Get, Query, Res } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { RegistryStore } from '../registry/registry-store.js';
import type { Overview } from '../registry/types.js';
import { renderOverviewContent, renderOverviewPage } from './overview.page.js';

/**
 * Xem registry bằng mắt người. Chỉ ĐỌC nên không cần token (giống snapshot);
 * registry chỉ nên mở trong mạng nội bộ.
 */
@Controller()
export class OverviewController {
  constructor(private readonly store: RegistryStore) {}

  /** Toàn cảnh dạng JSON: service → instance + health. Dùng cho monitoring/CLI. */
  @Get('v1/overview')
  overview(): Overview {
    return this.store.overview();
  }

  /**
   * Trang HTML. `?partial=1` chỉ trả phần nội dung (JS trên trang gọi mỗi 2s để thay vào).
   */
  @Get('lists')
  lists(@Query('partial') partial: string | undefined, @Res() res: Response): void {
    const overview = this.store.overview();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');

    if (partial === '1') {
      res.status(200).type('html').send(renderOverviewContent(overview));
      return;
    }

    // Nonce mới cho MỖI response: chỉ <script nonce="..."> do chính server sinh ra mới được chạy.
    const nonce = randomBytes(16).toString('base64');
    res.setHeader('Content-Security-Policy', contentSecurityPolicy(nonce));
    res.status(200).type('html').send(renderOverviewPage(overview, nonce));
  }
}

/**
 * CSP chặt: mặc định cấm hết, chỉ mở đúng thứ trang cần.
 * - script: chỉ script có nonce (không `unsafe-inline`) → script/handler bị chèn vào sẽ không chạy.
 * - style: cho phép inline (thanh lease dùng `style="width:..%"`); CSS không chạy được code.
 * - connect: chỉ gọi về chính registry (`fetch('/lists?partial=1')`).
 */
export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline'",
    "connect-src 'self'",
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}
