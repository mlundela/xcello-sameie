// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			session: Awaited<ReturnType<typeof import('$lib/server/auth').auth.api.getSession>>;
			/** Role in the active org, set by the handle hook; null without a session or active org */
			role: string | null;
		}
		interface PageData {
			/** From the (auth) layout: owners and admins may change data, members only read and upload receipts */
			canEdit?: boolean;
		}
		// interface Platform {}
	}
}

export {};
