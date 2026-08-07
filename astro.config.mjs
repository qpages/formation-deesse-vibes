// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';

import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: vercel(),

  server: {
      allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app', '.ngrok.io'],
	},

  vite: {
      plugins: [tailwindcss()],
	},

  integrations: [react()],
});