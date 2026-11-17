import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_IN_TRAY_MS, LAUNCH_WINDOW_MS, shouldInstall } from '../../src/platform/updates';

const mocks = vi.hoisted(() => ({
  check: vi.fn(), download: vi.fn(), install: vi.fn(), close: vi.fn(), relaunch: vi.fn(), isApp: true,
}));
vi.mock('../../src/platform/platform', () => ({ get isApp() { return mocks.isApp; } }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: mocks.check }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: mocks.relaunch }));

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

describe('checking for updates from Settings', () => {
  let stop = () => {};
  beforeEach(() => {
    stop = () => {};
    vi.resetModules();
    vi.resetAllMocks();
    vi.stubEnv('DEV', false);
    mocks.isApp = true;
    mocks.download.mockResolvedValue(undefined);
    mocks.install.mockResolvedValue(undefined);
    mocks.close.mockResolvedValue(undefined);
    mocks.relaunch.mockResolvedValue(undefined);
    mocks.check.mockResolvedValue({ version: '0.12.0', download: mocks.download, install: mocks.install, close: mocks.close });
  });
  afterEach(() => {
    stop();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('downloads and installs immediately, then restarts', async () => {
    const updates = await import('../../src/platform/updates');
    const phases: string[] = [];
    updates.onUpdatePhase(() => phases.push(updates.updatePhase()));
    await updates.checkForUpdates();
    expect(phases).toEqual(['checking', 'downloading', 'ready', 'installing']);
    expect(mocks.check).toHaveBeenCalledOnce();
    expect(mocks.download).toHaveBeenCalledOnce();
    expect(mocks.install).toHaveBeenCalledOnce();
    expect(mocks.relaunch).toHaveBeenCalledOnce();
    expect(mocks.download.mock.invocationCallOrder[0]).toBeLessThan(mocks.install.mock.invocationCallOrder[0]);
    expect(mocks.install.mock.invocationCallOrder[0]).toBeLessThan(mocks.relaunch.mock.invocationCallOrder[0]);
  });

  it('reports that the installed app is current without installing or restarting', async () => {
    mocks.check.mockResolvedValue(null);
    const updates = await import('../../src/platform/updates');
    await updates.checkForUpdates();
    expect(updates.updatePhase()).toBe('current');
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.install).not.toHaveBeenCalled();
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });

  it.each(['check', 'download', 'install'] as const)('reports a failed %s and allows a fresh retry', async (step) => {
    mocks[step].mockRejectedValueOnce(new Error('Failed'));
    const updates = await import('../../src/platform/updates');
    await updates.checkForUpdates();
    expect(updates.updatePhase()).toBe('error');
    expect(updates.readyVersion()).toBeNull();
    expect(mocks.relaunch).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledTimes(step === 'check' ? 0 : 1);
    await updates.checkForUpdates();
    expect(mocks.check).toHaveBeenCalledTimes(2);
    expect(mocks.relaunch).toHaveBeenCalledOnce();
  });

  it('joins a background download and installs only once for overlapping requests', async () => {
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
    let finishDownload!: () => void;
    mocks.download.mockReturnValue(new Promise<void>((resolve) => { finishDownload = resolve; }));
    const updates = await import('../../src/platform/updates');
    stop = updates.startUpdates();
    await vi.waitFor(() => expect(updates.updatePhase()).toBe('downloading'));
    const first = updates.checkForUpdates();
    const second = updates.checkForUpdates();
    finishDownload();
    await Promise.all([first, second]);
    // The background check may start installation first during the launch window.
    await vi.waitFor(() => expect(mocks.relaunch).toHaveBeenCalledOnce());
    expect(mocks.check).toHaveBeenCalledOnce();
    expect(mocks.download).toHaveBeenCalledOnce();
    expect(mocks.install).toHaveBeenCalledOnce();
    expect(mocks.relaunch).toHaveBeenCalledOnce();
  });

  it('installs an already downloaded background update without downloading again', async () => {
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
    const updates = await import('../../src/platform/updates');
    let now = 1_000_000;
    stop = updates.startUpdates(() => now);
    now += LAUNCH_WINDOW_MS + 1;
    await vi.waitFor(() => expect(updates.updatePhase()).toBe('ready'));
    expect(mocks.install).not.toHaveBeenCalled();
    await updates.checkForUpdates();
    expect(mocks.check).toHaveBeenCalledOnce();
    expect(mocks.download).toHaveBeenCalledOnce();
    expect(mocks.install).toHaveBeenCalledOnce();
  });

  it('skips browser and development builds', async () => {
    const updates = await import('../../src/platform/updates');
    mocks.isApp = false;
    await updates.checkForUpdates();
    mocks.isApp = true;
    vi.stubEnv('DEV', true);
    await updates.checkForUpdates();
    expect(mocks.check).not.toHaveBeenCalled();
    expect(updates.updatePhase()).toBe('none');
  });
});
