import { defineConfig } from 'vitest/config';

// Kept apart from vite.config.ts so tests don't start the Cloudflare plugin's Worker runtime.
// Worker tests call the fetch handler directly with a stub env.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
