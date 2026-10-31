import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.spec.ts'] },
  // Nest's dependency injection needs decorator metadata, which Vite's own transform drops.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
