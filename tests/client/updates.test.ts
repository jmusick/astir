import { describe, expect, it } from 'vitest';
import { IDLE_IN_TRAY_MS, LAUNCH_WINDOW_MS, shouldInstall } from '../../src/platform/updates';

describe('when a downloaded update installs by itself', () => {
  const launched = 1_000_000;
  it('installs right after launch', () => {
    expect(shouldInstall(launched + LAUNCH_WINDOW_MS - 1, launched, null)).toBe(true);
  });
  it('waits while the window is open after that', () => {
    expect(shouldInstall(launched + LAUNCH_WINDOW_MS + 1, launched, null)).toBe(false);
  });
  it('installs once the window has sat in the tray for a while', () => {
    const now = launched + 60 * 60_000;
    expect(shouldInstall(now, launched, now - IDLE_IN_TRAY_MS + 1)).toBe(false);
    expect(shouldInstall(now, launched, now - IDLE_IN_TRAY_MS)).toBe(true);
  });
});
