import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		// Kit's inline scripts get a nonce (a hash on prerendered pages). Styles stay 'unsafe-inline':
		// style attributes, like the one in app.html, can't carry a nonce.
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:'],
				// Organisation and address lookup when creating a sameie
				'connect-src': ['self', 'https://data.brreg.no', 'https://ws.geonorge.no'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'form-action': ['self'],
				'frame-ancestors': ['none']
			}
		},
		experimental: {
			remoteFunctions: true
		}
	}
};

export default config;
