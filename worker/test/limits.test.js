import { describe, expect, it } from 'vitest';
import { isAllowed } from '../src/limits.js';

describe('isAllowed', () => {
  it('lets everyone in when no allowlist is configured', () => {
    expect(isAllowed(undefined, 1)).toBe(true);
    expect(isAllowed('', 1)).toBe(true);
  });

  it('only lets listed ids in when an allowlist is set', () => {
    expect(isAllowed('10, 20 ,30', 20)).toBe(true);
    expect(isAllowed('10, 20 ,30', 99)).toBe(false);
  });

  it('compares ids as whole numbers, not prefixes', () => {
    expect(isAllowed('123', 12)).toBe(false);
  });
});
