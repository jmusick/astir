import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { registerServiceWorker } from './offline/registerServiceWorker';
import { isApp } from './platform/platform';
import { QUICK_ADD_WINDOW } from './platform/quickAdd';
import QuickAddBox from './platform/QuickAddBox';
import UpdateBanner from './platform/UpdateBanner';
import './index.css';

const render = (root: ReactNode) => createRoot(document.getElementById('root')!).render(<StrictMode>{root}</StrictMode>);

if (isApp) {
  // The app's second window is the quick-add box (D35); it shares this bundle but not the App.
  void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
    const quickAdd = getCurrentWindow().label === QUICK_ADD_WINDOW;
    if (quickAdd) document.documentElement.classList.add('quick-add-window');
    // Only the main window checks for updates, whoever is signed in.
    render(quickAdd ? <QuickAddBox /> : <><UpdateBanner /><App /></>);
  });
} else {
  render(<App />);
  registerServiceWorker();
}
