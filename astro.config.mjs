// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://cfbblindresume.com',
  output: 'static',
  // /teams/kentucky is served from teams/kentucky.html on Cloudflare Pages with no redirect,
  // so canonical URLs carry no trailing slash.
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
});
