import { matchesEtag } from './registry.controller.js';

describe('matchesEtag', () => {
  const etag = '"boot-3"';

  it.each([
    [undefined, false],
    ['"boot-2"', false],
    ['"boot-3"', true],
    ['W/"boot-3"', true],
    ['"a", "boot-3"', true],
    ['*', true],
  ])('If-None-Match %j → %s', (header, expected) => {
    expect(matchesEtag(header, etag)).toBe(expected);
  });
});
