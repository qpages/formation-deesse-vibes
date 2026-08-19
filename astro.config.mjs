// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
	output: 'server',
	adapter: vercel(),
	// Inngest / Stripe / Yousign POST+PUT from other origins. Default CSRF blocks them.
	security: {
		checkOrigin: false,
	},

	server: {
		allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app', '.ngrok.io'],
	},

	vite: {
		plugins: [tailwindcss()],
	},
});
