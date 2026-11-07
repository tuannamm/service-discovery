import { FakeClock } from './clock.js';
import { PatternConflictError, ValidationError } from './errors.js';
import { RegistryStore } from './registry-store.js';

const TTL = 15_000;

function setup() {
  const clock = new FakeClock(1_000);
  const store = new RegistryStore({ leaseTtlMs: TTL, clock, bootId: 'boot-1' });
  return { clock, store };
}

const echo = (overrides: Record<string, unknown> = {}) => ({
  service: 'echo',
  host: '127.0.0.1',
  port: 4001,
  patterns: ['user.getById', 'user.list'],
  ...overrides,
});

describe('RegistryStore', () => {
  describe('register', () => {
    it('adds a new instance, bumps the version and returns lease settings', () => {
      const { store } = setup();

      const result = store.register('example', 'echo-1', echo());

      expect(result).toEqual({ status: 'created', leaseTtlMs: TTL, heartbeatIntervalMs: 5_000 });
      expect(store.snapshot('example')).toEqual({
        project: 'example',
        version: 1,
        instances: [
          { id: 'echo-1', service: 'echo', host: '127.0.0.1', port: 4001, patterns: ['user.getById', 'user.list'] },
        ],
      });
    });

    it('treats an identical re-registration as a heartbeat: renews the lease WITHOUT bumping the version', () => {
      const { store, clock } = setup();
      store.register('example', 'echo-1', echo());

      clock.advance(10_000);
      const result = store.register('example', 'echo-1', echo({ patterns: ['user.list', 'user.getById'] }));
      clock.advance(10_000); // 20s sau lần đầu, nhưng chỉ 10s sau heartbeat → còn sống

      expect(result.status).toBe('renewed');
      expect(store.snapshot('example').version).toBe(1);
      expect(store.snapshot('example').instances).toHaveLength(1);
    });

    it('treats a re-registration with different data as an update and bumps the version', () => {
      const { store } = setup();
      store.register('example', 'echo-1', echo());

      const result = store.register('example', 'echo-1', echo({ port: 4005, patterns: ['user.create'] }));

      expect(result.status).toBe('updated');
      const snapshot = store.snapshot('example');
      expect(snapshot.version).toBe(2);
      expect(snapshot.instances[0]).toMatchObject({ port: 4005, patterns: ['user.create'] });
    });

    it('allows many instances of the SAME service to hold the same pattern (horizontal scaling)', () => {
      const { store } = setup();
      store.register('example', 'echo-1', echo());
      store.register('example', 'echo-2', echo({ port: 4002 }));

      expect(store.snapshot('example').instances.map((i) => i.id)).toEqual(['echo-1', 'echo-2']);
    });

    it('rejects a pattern already held by ANOTHER service and changes nothing', () => {
      const { store } = setup();
      store.register('example', 'echo-1', echo());

      const attempt = () =>
        store.register('example', 'user-1', echo({ service: 'user', port: 5001, patterns: ['user.create', 'user.list'] }));

      expect(attempt).toThrow(PatternConflictError);
      expect(attempt).toThrow(/Pattern "user\.list" in project "example" is already handled by service "echo"/);
      // Không ghi nửa vời: "user.create" (không xung đột) cũng KHÔNG được thêm.
      const snapshot = store.snapshot('example');
      expect(snapshot.version).toBe(1);
      expect(snapshot.instances.map((i) => i.id)).toEqual(['echo-1']);
    });

    it('frees a pattern once the last instance of its owner is gone', () => {
      const { store, clock } = setup();
      store.register('example', 'echo-1', echo());
      store.register('example', 'echo-2', echo({ port: 4002 }));
      store.deregister('example', 'echo-1');

      // echo-2 vẫn giữ pattern → vẫn xung đột
      expect(() => store.register('example', 'user-1', echo({ service: 'user', port: 5001 }))).toThrow(
        PatternConflictError,
      );

      clock.advance(TTL + 1); // echo-2 hết hạn (không heartbeat)
      expect(store.register('example', 'user-1', echo({ service: 'user', port: 5001 })).status).toBe('created');
    });

    it('lets an instance change its own service name without conflicting with itself', () => {
      const { store } = setup();
      store.register('example', 'svc-1', echo());

      expect(store.register('example', 'svc-1', echo({ service: 'user' })).status).toBe('updated');
      expect(store.snapshot('example').instances[0].service).toBe('user');
    });

    it('keeps projects isolated: the same pattern in two projects does not conflict', () => {
      const { store } = setup();
      store.register('shop', 'echo-1', echo());
      store.register('blog', 'user-1', echo({ service: 'user' }));

      expect(store.snapshot('shop').instances.map((i) => i.service)).toEqual(['echo']);
      expect(store.snapshot('blog').instances.map((i) => i.service)).toEqual(['user']);
    });

    it('validates input and reports every issue at once', () => {
      const { store } = setup();
      try {
        store.register('Bad Project', 'echo-1', { service: 'echo', host: '0.0.0.0', port: 0, patterns: [] });
        throw new Error('expected ValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).issues).toHaveLength(4); // project, host, port, patterns
      }
    });
  });

  describe('lease expiry', () => {
    it('keeps an instance until the TTL has fully elapsed', () => {
      const { store, clock } = setup();
      store.register('example', 'echo-1', echo());

      clock.advance(TTL);
      expect(store.snapshot('example').instances).toHaveLength(1);

      clock.advance(1);
      expect(store.snapshot('example').instances).toHaveLength(0);
    });

    it('sweep() removes expired instances across projects, returns them and bumps versions', () => {
      const { store, clock } = setup();
      store.register('shop', 'echo-1', echo());
      store.register('blog', 'echo-1', echo());
      clock.advance(5_000);
      store.register('blog', 'echo-2', echo({ port: 4002 }));

      clock.advance(TTL - 4_000); // echo-1 của cả hai project: 16s; echo-2: 11s
      const removed = store.sweep();

      expect(removed.map((r) => `${r.project}/${r.id}`).sort()).toEqual(['blog/echo-1', 'shop/echo-1']);
      expect(store.snapshot('shop')).toMatchObject({ version: 2, instances: [] });
      expect(store.snapshot('blog').instances.map((i) => i.id)).toEqual(['echo-2']);
    });

    it('sweep() with nothing expired changes nothing', () => {
      const { store } = setup();
      store.register('example', 'echo-1', echo());

      expect(store.sweep()).toEqual([]);
      expect(store.snapshot('example').version).toBe(1);
    });
  });

  describe('deregister', () => {
    it('removes the instance and bumps the version', () => {
      const { store } = setup();
      store.register('example', 'echo-1', echo());

      expect(store.deregister('example', 'echo-1')).toBe(true);
      expect(store.snapshot('example')).toMatchObject({ version: 2, instances: [] });
    });

    it('is idempotent: unknown id or project is not an error and changes nothing', () => {
      const { store } = setup();
      store.register('example', 'echo-1', echo());

      expect(store.deregister('example', 'nope')).toBe(false);
      expect(store.deregister('other', 'echo-1')).toBe(false);
      expect(store.snapshot('example').version).toBe(1);
    });
  });

  describe('snapshot and etag', () => {
    it('returns an empty snapshot with version 0 for an unknown project', () => {
      const { store } = setup();
      expect(store.snapshot('ghost')).toEqual({ project: 'ghost', version: 0, instances: [] });
    });

    it('never moves the version backwards when a project becomes empty', () => {
      const { store } = setup();
      store.register('example', 'echo-1', echo());
      store.deregister('example', 'echo-1');
      store.register('example', 'echo-1', echo());

      expect(store.snapshot('example').version).toBe(3);
    });

    it('includes the bootId in the ETag so a restarted registry never reuses an old tag', () => {
      const a = new RegistryStore({ leaseTtlMs: TTL, bootId: 'boot-a' });
      const b = new RegistryStore({ leaseTtlMs: TTL, bootId: 'boot-b' });
      a.register('example', 'echo-1', echo());
      b.register('example', 'user-1', echo({ service: 'user' }));

      // Cùng version 1 nhưng là hai bảng khác nhau → ETag phải khác.
      expect(a.etag(a.snapshot('example'))).toBe('"boot-a-1"');
      expect(b.etag(b.snapshot('example'))).toBe('"boot-b-1"');
    });

    it('sorts instances by id and patterns alphabetically for a stable output', () => {
      const { store } = setup();
      store.register('example', 'b', echo({ patterns: ['z', 'a'] }));
      store.register('example', 'a', echo({ patterns: ['z', 'a'] }));

      const { instances } = store.snapshot('example');
      expect(instances.map((i) => i.id)).toEqual(['a', 'b']);
      expect(instances[0].patterns).toEqual(['a', 'z']);
    });
  });

  it('projectsSummary lists every project with its version and live instance count', () => {
    const { store } = setup();
    store.register('shop', 'echo-1', echo());
    store.register('blog', 'echo-1', echo());
    store.register('blog', 'echo-2', echo({ port: 4002 }));

    expect(store.projectsSummary()).toEqual([
      { project: 'blog', version: 2, instanceCount: 2 },
      { project: 'shop', version: 1, instanceCount: 1 },
    ]);
  });

  it('derives heartbeatIntervalMs as TTL/3 and rejects a non-positive TTL', () => {
    expect(new RegistryStore({ leaseTtlMs: 9_000 }).heartbeatIntervalMs).toBe(3_000);
    expect(() => new RegistryStore({ leaseTtlMs: 0 })).toThrow(/leaseTtlMs/);
  });
});

describe('RegistryStore onExpire', () => {
  it('reports every expired instance, whether removed lazily or by sweep()', () => {
    const clock = new FakeClock();
    const expired: string[] = [];
    const store = new RegistryStore({ leaseTtlMs: TTL, clock, onExpire: (r) => expired.push(`${r.project}/${r.id}`) });
    store.register('shop', 'echo-1', echo());
    store.register('blog', 'echo-1', echo());

    clock.advance(TTL + 1);
    store.snapshot('shop'); // lazy
    store.sweep(); // định kỳ

    expect(expired).toEqual(['shop/echo-1', 'blog/echo-1']);
  });
});

describe('RegistryStore overview', () => {
  const WALL = Date.UTC(2026, 10, 7, 8, 0, 0);

  function setupOverview() {
    const clock = new FakeClock();
    const store = new RegistryStore({ leaseTtlMs: TTL, clock, bootId: 'boot-1', wallClock: () => WALL });
    return { clock, store };
  }

  it('groups instances by project and service, with the union of patterns', () => {
    const { store } = setupOverview();
    store.register('shop', 'echo-1', echo({ patterns: ['b', 'a'] }));
    store.register('shop', 'echo-2', echo({ port: 4002, patterns: ['c'] }));
    store.register('shop', 'user-1', echo({ service: 'user', port: 5001, patterns: ['user.me'] }));
    store.register('blog', 'post-1', echo({ service: 'post', patterns: ['post.list'] }));

    const overview = store.overview();

    expect(overview).toMatchObject({
      bootId: 'boot-1',
      generatedAt: '2026-11-07T08:00:00.000Z',
      leaseTtlMs: TTL,
      heartbeatIntervalMs: 5_000,
      healthyThresholdMs: 7_500,
    });
    expect(overview.projects.map((p) => p.project)).toEqual(['blog', 'shop']);
    const shop = overview.projects[1];
    expect(shop.services.map((s) => s.service)).toEqual(['echo', 'user']);
    expect(shop.services[0]).toMatchObject({ instanceCount: 2, healthyCount: 2, patterns: ['a', 'b', 'c'] });
    expect(shop.services[0].instances[0]).toEqual({
      id: 'echo-1',
      host: '127.0.0.1',
      port: 4001,
      patterns: ['a', 'b'],
      health: 'healthy',
      lastHeartbeatAgoMs: 0,
      leaseRemainingMs: TTL,
      registeredAt: '2026-11-07T08:00:00.000Z',
    });
  });

  it('marks an instance "late" once it missed a heartbeat (older than 1.5 intervals)', () => {
    const { store, clock } = setupOverview();
    store.register('shop', 'echo-1', echo());
    clock.advance(4_000);
    store.register('shop', 'echo-2', echo({ port: 4002 }));

    clock.advance(3_500); // echo-1: 7.5s (đúng ngưỡng) · echo-2: 3.5s
    expect(store.overview().projects[0].services[0].instances.map((i) => i.health)).toEqual(['healthy', 'healthy']);

    clock.advance(1); // echo-1: 7.501s → late
    const service = store.overview().projects[0].services[0];
    expect(service.instances.map((i) => [i.id, i.health])).toEqual([
      ['echo-1', 'late'],
      ['echo-2', 'healthy'],
    ]);
    expect(service.healthyCount).toBe(1);
    expect(service.instances[0].leaseRemainingMs).toBe(TTL - 7_501);
  });

  it('hides expired instances and projects left without instances', () => {
    const { store, clock } = setupOverview();
    store.register('shop', 'echo-1', echo());
    clock.advance(TTL + 1);

    expect(store.overview().projects).toEqual([]);
  });

  it('keeps registeredAt across heartbeats and updates of the same instance', () => {
    let wall = WALL;
    const store = new RegistryStore({ leaseTtlMs: TTL, clock: new FakeClock(), wallClock: () => wall });
    store.register('shop', 'echo-1', echo());
    wall += 60_000;
    store.register('shop', 'echo-1', echo());
    store.register('shop', 'echo-1', echo({ port: 4009 }));

    expect(store.overview().projects[0].services[0].instances[0].registeredAt).toBe('2026-11-07T08:00:00.000Z');
  });
});
