import { ValidationError } from './errors.js';
import { validateRegistration } from './validation.js';

const valid = { service: 'echo', host: 'echo.internal', port: 4001, patterns: ['user.getById'] };

function issuesOf(body: unknown, project = 'example', id = 'echo-1'): string[] {
  try {
    validateRegistration(project, id, body);
    return [];
  } catch (error) {
    if (error instanceof ValidationError) return error.issues;
    throw error;
  }
}

describe('validateRegistration', () => {
  it('accepts a valid body and drops unknown fields', () => {
    expect(validateRegistration('example', 'echo-1', { ...valid, extra: 'ignored' })).toEqual(valid);
  });

  it('keeps string metadata', () => {
    expect(validateRegistration('example', 'echo-1', { ...valid, metadata: { zone: 'a' } }).metadata).toEqual({
      zone: 'a',
    });
  });

  it.each([null, 'text', 42, ['array']])('rejects a non-object body: %j', (body) => {
    expect(issuesOf(body)).toContain('Body must be a JSON object.');
  });

  it('rejects invalid project and id names', () => {
    expect(issuesOf(valid, '../etc', 'bad id')).toEqual([
      expect.stringContaining('"project"'),
      expect.stringContaining('"id"'),
    ]);
  });

  it.each(['0.0.0.0', '::', '[::]'])('rejects the unroutable host %s', (host) => {
    expect(issuesOf({ ...valid, host })).toEqual([expect.stringContaining('advertise host')]);
  });

  it.each([0, 65_536, 4001.5, '4001'])('rejects port %j', (port) => {
    expect(issuesOf({ ...valid, port })).toEqual([expect.stringContaining('"port"')]);
  });

  it.each([
    [[], '"patterns" must be an array'],
    ['user.getById', '"patterns" must be an array'],
    [['ok', ''], '"patterns[1]"'],
    [['ok', ' padded '], '"patterns[1]"'],
    [['ok', 'ok'], 'duplicates'],
  ])('rejects patterns %j', (patterns, message) => {
    expect(issuesOf({ ...valid, patterns })).toEqual([expect.stringContaining(message)]);
  });

  it('rejects non-string metadata values', () => {
    expect(issuesOf({ ...valid, metadata: { weight: 3 } })).toEqual([expect.stringContaining('"metadata.weight"')]);
  });

  it('reports all problems together', () => {
    expect(issuesOf({ service: 'Echo!', host: '', port: -1, patterns: 'x' })).toHaveLength(4);
  });
});
