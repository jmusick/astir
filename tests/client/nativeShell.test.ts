import { describe, expect, it } from 'vitest';
import { badgeText, systemName } from '../../src/platform/nativeShell';

describe('native shell helpers', () => {
  it('shows nothing at zero and keeps big counts short', () => {
    expect(badgeText(0)).toBe('');
    expect(badgeText(-1)).toBe('');
    expect(badgeText(4)).toBe('4');
    expect(badgeText(9)).toBe('9');
    expect(badgeText(10)).toBe('9+');
  });
  it('names the system for "Start with …"', () => {
    expect(systemName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows');
    expect(systemName('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('your Mac');
    expect(systemName('Mozilla/5.0 (X11; Linux x86_64)')).toBe('your computer');
  });
});
