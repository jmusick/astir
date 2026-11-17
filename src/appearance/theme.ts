export const THEME_KEY = 'astir-theme';

export const themes = [
  { id: 'signal', name: 'Signal', description: 'Yellow and ink', mode: 'Light', background: '#ffffff', colors: ['#f4d447', '#20251f', '#f3f4ee'] },
  { id: 'blueprint', name: 'Blueprint', description: 'Blue and cool white', mode: 'Light', background: '#ffffff', colors: ['#c7ddf8', '#214f85', '#eef3f9'] },
  { id: 'fern', name: 'Fern', description: 'Leaf and forest', mode: 'Light', background: '#fbfdf9', colors: ['#d6e3b8', '#28513b', '#edf3e9'] },
  { id: 'midnight', name: 'Midnight', description: 'Navy and sea glass', mode: 'Dark', background: '#172832', colors: ['#284953', '#a5d8d2', '#203842'] },
  { id: 'carbon', name: 'Carbon', description: 'Charcoal and amber', mode: 'Dark', background: '#242522', colors: ['#494128', '#edcf80', '#30322c'] },
] as const;

export type ThemeId = typeof themes[number]['id'];
export const isTheme = (value: unknown): value is ThemeId => themes.some(theme => theme.id === value);

function preferredTheme(): ThemeId {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'midnight' : 'signal';
}

function savedTheme(): ThemeId | null {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return isTheme(value) ? value : null;
  } catch { return null; }
}

export function currentTheme(): ThemeId {
  const value = document.documentElement.dataset.theme;
  return isTheme(value) ? value : preferredTheme();
}

function applyTheme(id: ThemeId) {
  const theme = themes.find(theme => theme.id === id)!;
  document.documentElement.dataset.theme = id;
  document.documentElement.style.colorScheme = theme.mode.toLowerCase();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.background);
  window.dispatchEvent(new Event('astir-theme-change'));
}

/** Applies immediately, even when the browser refuses to save the preference. */
export function selectTheme(id: ThemeId): boolean {
  applyTheme(id);
  try { localStorage.setItem(THEME_KEY, id); return true; } catch { return false; }
}

export function subscribeTheme(changed: () => void) {
  window.addEventListener('astir-theme-change', changed);
  return () => window.removeEventListener('astir-theme-change', changed);
}

/** All webviews use the same origin storage, so the quick-add box follows the main window. */
export function initializeTheme() {
  applyTheme(savedTheme() ?? preferredTheme());
  const storage = (event: StorageEvent) => {
    if (event.key === THEME_KEY || event.key === null) applyTheme(savedTheme() ?? preferredTheme());
  };
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const changed = () => { if (!savedTheme()) applyTheme(preferredTheme()); };
  window.addEventListener('storage', storage);
  system.addEventListener('change', changed);
  return () => { window.removeEventListener('storage', storage); system.removeEventListener('change', changed); };
}
