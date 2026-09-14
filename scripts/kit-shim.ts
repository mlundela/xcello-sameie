// Lets plain `bun` run modules written for SvelteKit, such as src/lib/server/seed.ts:
// `bun --preload ./scripts/kit-shim.ts <file>`. Provides the two virtual modules the server
// code imports; `$lib/*` resolves through the tsconfig paths SvelteKit generates.
import { plugin } from 'bun';

plugin({
	name: 'sveltekit-virtual-modules',
	setup(build) {
		build.module('$env/dynamic/private', () => ({ exports: { env: process.env }, loader: 'object' }));
		build.module('$app/environment', () => ({ exports: { building: false, dev: true, browser: false, version: 'script' }, loader: 'object' }));
	}
});
