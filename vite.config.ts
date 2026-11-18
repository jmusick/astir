import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

const SERVICE_WORKER = 'sw.js';
const PLACEHOLDER = /(["'`])__ASTIR_SHELL_BUILD__\1/;

/**
 * Builds src/offline/serviceWorker.ts to /sw.js (D33) and hands it this build's files to keep
 * offline: the shell page plus every emitted asset. Client build only; the dev server has none.
 */
function serviceWorker(): Plugin {
  return {
    name: 'astir-service-worker',
    apply: 'build',
    applyToEnvironment: (environment) => environment.name === 'client',
    buildStart() {
      this.emitFile({ type: 'chunk', id: 'src/offline/serviceWorker.ts', fileName: SERVICE_WORKER });
    },
    generateBundle(_options, bundle) {
      // Files from public/ are copied as they are and never enter the bundle. Cloudflare's own
      // config files (_headers, _redirects) and dotfiles aren't served.
      const { publicDir } = this.environment.config;
      const publicFiles = publicDir && existsSync(publicDir)
        ? readdirSync(publicDir, { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => relative(publicDir, join(entry.parentPath, entry.name)).split(sep).join('/'))
          .filter((name) => !name.split('/').some((part) => part.startsWith('_') || part.startsWith('.')))
        : [];
      const files = [...Object.keys(bundle), ...publicFiles]
        .filter((name) => name !== SERVICE_WORKER && name !== 'index.html' && !name.endsWith('.map') && !name.startsWith('.'))
        .sort()
        .map((name) => `/${name}`);
      // index.html is served at /, and its hashed assets change whenever it does.
      const html = bundle['index.html'];
      const htmlSource = html?.type === 'asset' ? String(html.source) : '';
      // Public files keep their names, so their contents go into the version too.
      const hash = createHash('sha256').update(JSON.stringify(files)).update(htmlSource);
      for (const name of publicFiles) hash.update(readFileSync(join(publicDir, name)));
      const version = hash.digest('hex').slice(0, 16);
      const chunk = bundle[SERVICE_WORKER];
      if (chunk?.type !== 'chunk' || !PLACEHOLDER.test(chunk.code)) this.error(`${SERVICE_WORKER} is missing its build placeholder.`);
      // It runs as a classic script, so it can't import a chunk it shares with the app.
      if (chunk.imports.length || chunk.dynamicImports.length) {
        this.error(`${SERVICE_WORKER} must not share modules with the app; it imports ${[...chunk.imports, ...chunk.dynamicImports].join(', ')}.`);
      }
      chunk.code = chunk.code.replace(PLACEHOLDER, JSON.stringify(JSON.stringify({ version, files })));
    },
  };
}

// The Cloudflare plugin runs the Worker (worker/index.ts) inside Vite's dev server against local
// D1, so `npm run dev` serves the React UI and the API from one origin.
export default defineConfig({
  plugins: [react(), cloudflare(), serviceWorker()],
  // The footer's version; /release bumps package.json, so it never needs editing by hand.
  define: { __APP_VERSION__: JSON.stringify((JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version) },
});
