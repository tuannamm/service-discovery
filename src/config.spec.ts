import { ConfigError, loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({})).toEqual({ port: 8500, leaseTtlMs: 15_000, token: undefined, bodyLimit: '64kb' });
  });

  it('reads values from env', () => {
    expect(
      loadConfig({ PORT: '9000', REGISTRY_LEASE_TTL_MS: '30000', REGISTRY_TOKEN: 'a-long-enough-secret' }),
    ).toMatchObject({ port: 9000, leaseTtlMs: 30_000, token: 'a-long-enough-secret' });
  });

  it.each([
    ['PORT', '0'],
    ['PORT', 'abc'],
    ['REGISTRY_LEASE_TTL_MS', '500'],
    ['REGISTRY_LEASE_TTL_MS', '-1'],
  ])('fails fast on invalid %s=%s', (name, value) => {
    expect(() => loadConfig({ [name]: value })).toThrow(ConfigError);
  });

  it('rejects a token that is too short to be a secret', () => {
    expect(() => loadConfig({ REGISTRY_TOKEN: 'short' })).toThrow(/at least 16/);
  });
});
