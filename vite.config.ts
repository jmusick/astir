import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The Cloudflare plugin runs the Worker (worker/index.ts) inside Vite's dev server against local
// D1, so `npm run dev` serves the React UI and the API from one origin.
export default defineConfig({
  plugins: [react(), cloudflare()],
});
