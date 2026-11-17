import { describe, expect, it } from 'vitest';
import { shortcutFromKey, shortcutLabel } from '../../src/platform/quickAdd';

const press = (code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) =>
  shortcutFromKey({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

describe('quick-add shortcut', () => {
  it('turns a key press into an accelerator', () => {
    expect(press('Space', { ctrlKey: true, altKey: true })).toBe('CommandOrControl+Alt+Space');
    expect(press('KeyT', { ctrlKey: true, shiftKey: true })).toBe('CommandOrControl+Shift+T');
    expect(press('Digit7', { altKey: true })).toBe('Alt+7');
    expect(press('F9', { metaKey: true })).toBe('Super+F9');
  });

  it('waits for a real key and refuses shortcuts without Ctrl, Alt or Win', () => {
    expect(press('ControlLeft', { ctrlKey: true })).toBeNull();
    expect(press('KeyT')).toBeNull();
    expect(press('KeyT', { shiftKey: true })).toBeNull();
  });

  it('labels shortcuts for people', () => {
    expect(shortcutLabel('CommandOrControl+Alt+Space', false)).toBe('Ctrl+Alt+Space');
    expect(shortcutLabel('CommandOrControl+Alt+Space', true)).toBe('Cmd+Option+Space');
    expect(shortcutLabel('Super+F9', false)).toBe('Win+F9');
  });
});
