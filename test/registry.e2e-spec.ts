import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { RegistryConfig } from '../src/config.js';
import { createRegistryApp } from '../src/create-app.js';
import { FakeClock } from '../src/registry/clock.js';

/**
 * E2E: HTTP thật (supertest) → Express → controller → RegistryStore.
 * FakeClock để kiểm tra hết hạn lease mà không phải chờ 15s.
 */
const TOKEN = 'test-token-0123456789';
const echo = { service: 'echo', host: '127.0.0.1', port: 4001, patterns: ['user.getById', 'user.list'] };

async function start(overrides: Partial<RegistryConfig> = {}) {
  const clock = new FakeClock();
  const config: RegistryConfig = { port: 0, leaseTtlMs: 15_000, bodyLimit: '64kb', ...overrides };
  const app = await createRegistryApp({ config, clock }, false);
  await app.init();
  return { app, clock, http: () => request(app.getHttpServer()) };
}

describe('Service Registry (e2e)', () => {
  let app: NestExpressApplication;
  let clock: FakeClock;
  let http: Awaited<ReturnType<typeof start>>['http'];

  beforeEach(async () => {
    ({ app, clock, http } = await start());
  });

  afterEach(async () => {
    await app.close();
  });

  it('registers, serves the snapshot with an ETag, then answers 304 while nothing changes', async () => {
    const put = await http().put('/v1/instances/echo-1').send(echo).expect(200);
    expect(put.body).toEqual({ status: 'created', leaseTtlMs: 15_000, heartbeatIntervalMs: 5_000 });

    const first = await http().get('/v1/snapshot').expect(200);
    expect(first.body).toMatchObject({ version: 1, instances: [{ id: 'echo-1', port: 4001 }] });
    const etag = first.headers.etag;
    expect(etag).toMatch(/^"[0-9a-f-]+-1"$/);

    // Heartbeat không đổi dữ liệu → bảng không đổi → 304, không body.
    await http().put('/v1/instances/echo-1').send(echo).expect(200, { status: 'renewed', leaseTtlMs: 15_000, heartbeatIntervalMs: 5_000 });
    const notModified = await http().get('/v1/snapshot').set('If-None-Match', etag).expect(304);
    expect(notModified.text).toBe('');

    // Đổi dữ liệu → ETag mới → 200.
    await http().put('/v1/instances/echo-2').send({ ...echo, port: 4002 }).expect(200);
    const changed = await http().get('/v1/snapshot').set('If-None-Match', etag).expect(200);
    expect(changed.headers.etag).not.toBe(etag);
    expect(changed.body.instances).toHaveLength(2);
  });

  it('deregisters with 204, and DELETE is idempotent', async () => {
    await http().put('/v1/instances/echo-1').send(echo).expect(200);

    await http().delete('/v1/instances/echo-1').expect(204);
    await http().delete('/v1/instances/echo-1').expect(204);

    const snapshot = await http().get('/v1/snapshot').expect(200);
    expect(snapshot.body.instances).toEqual([]);
  });

  it('removes an instance whose lease expired', async () => {
    await http().put('/v1/instances/echo-1').send(echo).expect(200);

    clock.advance(15_001);

    const snapshot = await http().get('/v1/snapshot').expect(200);
    expect(snapshot.body).toMatchObject({ version: 2, instances: [] });
  });

  it('returns 409 problem+json when another service already holds a pattern', async () => {
    await http().put('/v1/instances/echo-1').send(echo).expect(200);

    const res = await http()
      .put('/v1/instances/user-1')
      .send({ ...echo, service: 'user', port: 5001 })
      .expect(409)
      .expect('content-type', /application\/problem\+json/);

    expect(res.body).toMatchObject({
      status: 409,
      code: 'PATTERN_CONFLICT',
      instance: '/v1/instances/user-1',
      conflicts: [
        { pattern: 'user.getById', owner: 'echo' },
        { pattern: 'user.list', owner: 'echo' },
      ],
    });
  });

  it('returns 400 with every validation issue', async () => {
    const res = await http()
      .put('/v1/instances/echo-1')
      .send({ service: 'echo', host: '0.0.0.0', port: 99999, patterns: [] })
      .expect(400)
      .expect('content-type', /application\/problem\+json/);

    expect(res.body.code).toBe('INVALID_REGISTRATION');
    expect(res.body.errors).toHaveLength(3);
  });

  it('returns 400 for malformed JSON and 413 for an oversized body', async () => {
    await http()
      .put('/v1/instances/echo-1')
      .set('content-type', 'application/json')
      .send('{"service":')
      .expect(400)
      .expect('content-type', /application\/problem\+json/);

    const huge = { ...echo, metadata: { blob: 'x'.repeat(70 * 1024) } };
    await http()
      .put('/v1/instances/echo-1')
      .send(huge)
      .expect(413)
      .expect('content-type', /application\/problem\+json/);
  });

  it('returns 400 for an invalid instance id', async () => {
    await http().put('/v1/instances/bad%20id').send(echo).expect(400);
  });

  it('no longer exposes the old per-project routes', async () => {
    await http().get('/v1/projects/example/snapshot').expect(404);
    await http().put('/v1/projects/example/instances/echo-1').send(echo).expect(404);
    await http().get('/v1/projects').expect(404);
  });

  it('returns 404 problem+json for unknown routes', async () => {
    const res = await http().get('/nope').expect(404).expect('content-type', /application\/problem\+json/);
    expect(res.body.status).toBe(404);
  });

  it('answers health checks', async () => {
    await http().put('/v1/instances/echo-1').send(echo).expect(200);

    const health = await http().get('/health').expect(200);
    expect(health.body.status).toBe('ok');
  });

  describe('with REGISTRY_TOKEN', () => {
    let secured: Awaited<ReturnType<typeof start>>;

    beforeEach(async () => {
      secured = await start({ token: TOKEN });
    });

    afterEach(async () => {
      await secured.app.close();
    });

    it('requires the token for writes but not for reads', async () => {
      await secured.http().put('/v1/instances/echo-1').send(echo).expect(401);
      await secured.http().put('/v1/instances/echo-1').set('x-registry-token', 'wrong').send(echo).expect(401);
      await secured.http().delete('/v1/instances/echo-1').expect(401);

      await secured.http().put('/v1/instances/echo-1').set('x-registry-token', TOKEN).send(echo).expect(200);
      await secured.http().get('/v1/snapshot').expect(200);
    });
  });
});

describe('Registry overview UI (e2e)', () => {
  let ctx: Awaited<ReturnType<typeof start>>;

  beforeEach(async () => {
    ctx = await start();
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('GET /v1/overview groups instances by service with health', async () => {
    await ctx.http().put('/v1/instances/echo-1').send(echo).expect(200);
    await ctx.http().put('/v1/instances/echo-2').send({ ...echo, port: 4002 }).expect(200);
    ctx.clock.advance(8_000);
    await ctx.http().put('/v1/instances/echo-2').send({ ...echo, port: 4002 }).expect(200);

    const res = await ctx.http().get('/v1/overview').expect(200);

    const service = res.body.services[0];
    expect(res.body.version).toBeGreaterThan(0);
    expect(service).toMatchObject({ service: 'echo', instanceCount: 2, healthyCount: 1, patterns: ['user.getById', 'user.list'] });
    expect(service.instances.map((i: { id: string; health: string }) => [i.id, i.health])).toEqual([
      ['echo-1', 'late'],
      ['echo-2', 'healthy'],
    ]);
  });

  it('GET /lists returns an HTML page with a strict nonce-based CSP', async () => {
    await ctx.http().put('/v1/instances/echo-1').send(echo).expect(200);

    const res = await ctx.http().get('/lists').expect(200).expect('content-type', /text\/html/);

    const csp = res.headers['content-security-policy'];
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).toContain("default-src 'none'");
    expect(res.text).toContain(`<script nonce="${nonce}">`);
    expect(res.text).toContain('<h3>echo</h3>');
    expect(res.text).toContain('user.getById');
    expect(res.text).toContain('1/1 healthy');
    // Cột "Message pattern đã đăng ký" liệt kê từng pattern của instance (không chỉ đếm số lượng).
    const row = res.text.slice(res.text.indexOf('<tbody>'), res.text.indexOf('</tbody>'));
    expect(row).toContain('<code class="chip" data-pattern="user.getbyid">user.getById</code>');
    expect(row).toContain('<code class="chip" data-pattern="user.list">user.list</code>');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('uses a fresh nonce for every page load', async () => {
    const a = await ctx.http().get('/lists').expect(200);
    const b = await ctx.http().get('/lists').expect(200);
    expect(a.headers['content-security-policy']).not.toBe(b.headers['content-security-policy']);
  });

  it('escapes values sent by services (no stored XSS)', async () => {
    await ctx.http()
      .put('/v1/instances/evil-1')
      .send({
        service: 'evil',
        host: 'h"><script>alert(1)</script>',
        port: 4001,
        patterns: ['<img src=x onerror=alert(1)>'],
        metadata: { note: '</td><script>alert(2)</script>' },
      })
      .expect(200);

    const res = await ctx.http().get('/lists').expect(200);

    expect(res.text).not.toContain('<script>alert');
    expect(res.text).not.toContain('<img src=x');
    expect(res.text).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(res.text).toContain('&lt;/td&gt;&lt;script&gt;alert(2)&lt;/script&gt;');
  });

  it('GET /lists?partial=1 returns only the content fragment, and an empty state when nothing is registered', async () => {
    const res = await ctx.http().get('/lists?partial=1').expect(200).expect('content-type', /text\/html/);

    expect(res.text).not.toContain('<html');
    expect(res.text).toContain('Chưa có service nào đăng ký');
    expect(res.headers['content-security-policy']).toBeUndefined();
  });
});
