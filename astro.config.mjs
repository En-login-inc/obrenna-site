// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import cloudflare from '@astrojs/cloudflare';

// `astro dev` keeps pre-bundled deps in its own cache so `astro build` /
// `astro check` can't overwrite files a running dev server still points at.
const isDev = process.argv.includes('dev');

export default defineConfig({
  site: 'https://obrenna.com',
  integrations: [react(), sitemap()],
  adapter: cloudflare(),
  output: 'server',
  vite: {
    cacheDir: isDev ? 'node_modules/.vite-dev' : 'node_modules/.vite-build',
    plugins: [tailwindcss()],
  },
  server: {
    port: 4321,
  },
});
