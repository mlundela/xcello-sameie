// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			session: Awaited<ReturnType<typeof import('$lib/server/auth').auth.api.getSession>>;
		}
		// interface PageData {}
		// interface Platform {}
	}
}

export {};
