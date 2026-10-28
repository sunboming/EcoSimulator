import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({ root: 'client', build: { outDir: '../dist/public', emptyOutDir: true, rollupOptions: { input: { world: resolve('client/index.html'), settings: resolve('client/settings.html') } } } });
