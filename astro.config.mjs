// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://obrenna.com',
  integrations: [react(), sitemap()],
  adapter: cloudflare(),
  output: 'server',
  vite: {
    plugins: [tailwindcss()],
  },
  server: {
    port: 4321,
  },
});
