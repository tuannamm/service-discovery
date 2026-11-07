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

      const result = store.register('echo-1', echo());

      expect(result).toEqual({ status: 'created', leaseTtlMs: TTL, heartbeatIntervalMs: 5_000 });
      expect(store.snapshot()).toEqual({
        version: 1,
        instances: [
          { id: 'echo-1', service: 'echo', host: '127.0.0.1', port: 4001, patterns: ['user.getById', 'user.list'] },
        ],
      });
    });

    it('treats an identical re-registration as a heartbeat: renews the lease WITHOUT bumping the version', () => {
      const { store, clock } = setup();
      store.register('echo-1', echo());

      clock.advance(10_000);
      const result = store.register('echo-1', echo({ patterns: ['user.list', 'user.getById'] }));
      clock.advance(10_000); // 20s sau lần đầu, nhưng chỉ 10s sau heartbeat → còn sống

      expect(result.status).toBe('renewed');
      expect(store.snapshot().version).toBe(1);
      expect(store.snapshot().instances).toHaveLength(1);
    });

    it('treats a re-registration with different data as an update and bumps the version', () => {
      const { store } = setup();
      store.register('echo-1', echo());

      const result = store.register('echo-1', echo({ port: 4005, patterns: ['user.create'] }));

      expect(result.status).toBe('updated');
      const snapshot = store.snapshot();
      expect(snapshot.version).toBe(2);
      expect(snapshot.instances[0]).toMatchObject({ port: 4005, patterns: ['user.create'] });
    });

    it('allows many instances of the SAME service to hold the same pattern (horizontal scaling)', () => {
      const { store } = setup();
      store.register('echo-1', echo());
      store.register('echo-2', echo({ port: 4002 }));

      expect(store.snapshot().instances.map((i) => i.id)).toEqual(['echo-1', 'echo-2']);
    });

    it('rejects a pattern already held by ANOTHER service and changes nothing', () => {
      const { store } = setup();
      store.register('echo-1', echo());

      const attempt = () =>
        store.register('user-1', echo({ service: 'user', port: 5001, patterns: ['user.create', 'user.list'] }));

      expect(attempt).toThrow(PatternConflictError);
      expect(attempt).toThrow(/Pattern "user\.list" is already handled by service "echo"/);
      // Không ghi nửa vời: "user.create" (không xung đột) cũng KHÔNG được thêm.
      const snapshot = store.snapshot();
      expect(snapshot.version).toBe(1);
      expect(snapshot.instances.map((i) => i.id)).toEqual(['echo-1']);
    });

    it('frees a pattern once the last instance of its owner is gone', () => {
      const { store, clock } = setup();
      store.register('echo-1', echo());
      store.register('echo-2', echo({ port: 4002 }));
      store.deregister('echo-1');

      // echo-2 vẫn giữ pattern → vẫn xung đột
      expect(() => store.register('user-1', echo({ service: 'user', port: 5001 }))).toThrow(PatternConflictError);

      clock.advance(TTL + 1); // echo-2 hết hạn (không heartbeat)
      expect(store.register('user-1', echo({ service: 'user', port: 5001 })).status).toBe('created');
    });

    it('lets an instance change its own service name without conflicting with itself', () => {
      const { store } = setup();
      store.register('svc-1', echo());

      expect(store.register('svc-1', echo({ service: 'user' })).status).toBe('updated');
      expect(store.snapshot().instances[0].service).toBe('user');
    });

    it('enforces "one pattern, one service" across the WHOLE registry (there is no project scope)', () => {
      const { store } = setup();
      store.register('echo-1', echo());

      expect(() => store.register('other-1', echo({ service: 'other', port: 6001 }))).toThrow(PatternConflictError);
    });

    it('validates input and reports every issue at once', () => {
      const { store } = setup();
      try {
        store.register('bad id', { service: 'echo', host: '0.0.0.0', port: 0, patterns: [] });
        throw new Error('expected ValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).issues).toHaveLength(4); // id, host, port, patterns
      }
    });
  });

  describe('lease expiry', () => {
    it('keeps an instance until the TTL has fully elapsed', () => {
      const { store, clock } = setup();
      store.register('echo-1', echo());

      clock.advance(TTL);
      expect(store.snapshot().instances).toHaveLength(1);

      clock.advance(1);
      expect(store.snapshot().instances).toHaveLength(0);
    });

    it('sweep() removes expired instances, returns them and bumps the version', () => {
      const { store, clock } = setup();
      store.register('echo-1', echo());
      clock.advance(5_000);
      store.register('user-1', echo({ service: 'user', port: 5001, patterns: ['user.me'] }));

      clock.advance(TTL - 4_000); // echo-1: 16s; user-1: 11s
      const removed = store.sweep();

      expect(removed.map((r) => r.id)).toEqual(['echo-1']);
      expect(store.snapshot()).toMatchObject({ version: 3, instances: [{ id: 'user-1' }] });
    });

    it('sweep() with nothing expired changes nothing', () => {
      const { store } = setup();
      store.register('echo-1', echo());

      expect(store.sweep()).toEqual([]);
      expect(store.snapshot().version).toBe(1);
    });
  });

  describe('deregister', () => {
    it('removes the instance and bumps the version', () => {
      const { store } = setup();
      store.register('echo-1', echo());

      expect(store.deregister('echo-1')).toBe(true);
      expect(store.snapshot()).toMatchObject({ version: 2, instances: [] });
    });

    it('is idempotent: an unknown id is not an error and changes nothing', () => {
      const { store } = setup();
      store.register('echo-1', echo());

      expect(store.deregister('nope')).toBe(false);
      expect(store.snapshot().version).toBe(1);
    });
  });

  describe('snapshot and etag', () => {
    it('returns an empty snapshot with version 0 when nothing is registered', () => {
      const { store } = setup();
      expect(store.snapshot()).toEqual({ version: 0, instances: [] });
    });

    it('never moves the version backwards when the registry becomes empty', () => {
      const { store } = setup();
      store.register('echo-1', echo());
      store.deregister('echo-1');
      store.register('echo-1', echo());

      expect(store.snapshot().version).toBe(3);
    });

    it('includes the bootId in the ETag so a restarted registry never reuses an old tag', () => {
      const a = new RegistryStore({ leaseTtlMs: TTL, bootId: 'boot-a' });
      const b = new RegistryStore({ leaseTtlMs: TTL, bootId: 'boot-b' });
      a.register('echo-1', echo());
      b.register('user-1', echo({ service: 'user' }));

      // Cùng version 1 nhưng là hai bảng khác nhau → ETag phải khác.
      expect(a.etag(a.snapshot())).toBe('"boot-a-1"');
      expect(b.etag(b.snapshot())).toBe('"boot-b-1"');
    });

    it('sorts instances by id and patterns alphabetically for a stable output', () => {
      const { store } = setup();
      store.register('b', echo({ patterns: ['z', 'a'] }));
      store.register('a', echo({ patterns: ['z', 'a'] }));

      const { instances } = store.snapshot();
      expect(instances.map((i) => i.id)).toEqual(['a', 'b']);
      expect(instances[0].patterns).toEqual(['a', 'z']);
    });
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
    const store = new RegistryStore({ leaseTtlMs: TTL, clock, onExpire: (r) => expired.push(r.id) });
    store.register('echo-1', echo());
    store.register('user-1', echo({ service: 'user', patterns: ['user.me'] }));

    clock.advance(TTL + 1);
    store.snapshot(); // lazy: gỡ cả hai ngay khi đọc
    store.sweep(); // định kỳ: không còn gì để gỡ, không báo trùng

    expect(expired).toEqual(['echo-1', 'user-1']);
  });
});

describe('RegistryStore overview', () => {
  const WALL = Date.UTC(2026, 10, 7, 8, 0, 0);

  function setupOverview() {
    const clock = new FakeClock();
    const store = new RegistryStore({ leaseTtlMs: TTL, clock, bootId: 'boot-1', wallClock: () => WALL });
    return { clock, store };
  }

  it('groups instances by service, with the union of patterns', () => {
    const { store } = setupOverview();
    store.register('echo-1', echo({ patterns: ['b', 'a'] }));
    store.register('echo-2', echo({ port: 4002, patterns: ['c'] }));
    store.register('user-1', echo({ service: 'user', port: 5001, patterns: ['user.me'] }));

    const overview = store.overview();

    expect(overview).toMatchObject({
      bootId: 'boot-1',
      generatedAt: '2026-11-07T08:00:00.000Z',
      leaseTtlMs: TTL,
      heartbeatIntervalMs: 5_000,
      healthyThresholdMs: 7_500,
      version: 3,
    });
    expect(overview.services.map((s) => s.service)).toEqual(['echo', 'user']);
    expect(overview.services[0]).toMatchObject({ instanceCount: 2, healthyCount: 2, patterns: ['a', 'b', 'c'] });
    expect(overview.services[0].instances[0]).toEqual({
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
    store.register('echo-1', echo());
    clock.advance(4_000);
    store.register('echo-2', echo({ port: 4002 }));

    clock.advance(3_500); // echo-1: 7.5s (đúng ngưỡng) · echo-2: 3.5s
    expect(store.overview().services[0].instances.map((i) => i.health)).toEqual(['healthy', 'healthy']);

    clock.advance(1); // echo-1: 7.501s → late
    const service = store.overview().services[0];
    expect(service.instances.map((i) => [i.id, i.health])).toEqual([
      ['echo-1', 'late'],
      ['echo-2', 'healthy'],
    ]);
    expect(service.healthyCount).toBe(1);
    expect(service.instances[0].leaseRemainingMs).toBe(TTL - 7_501);
  });

  it('hides expired instances', () => {
    const { store, clock } = setupOverview();
    store.register('echo-1', echo());
    clock.advance(TTL + 1);

    expect(store.overview().services).toEqual([]);
  });

  it('keeps registeredAt across heartbeats and updates of the same instance', () => {
    let wall = WALL;
    const store = new RegistryStore({ leaseTtlMs: TTL, clock: new FakeClock(), wallClock: () => wall });
    store.register('echo-1', echo());
    wall += 60_000;
    store.register('echo-1', echo());
    store.register('echo-1', echo({ port: 4009 }));

    expect(store.overview().services[0].instances[0].registeredAt).toBe('2026-11-07T08:00:00.000Z');
  });
});
