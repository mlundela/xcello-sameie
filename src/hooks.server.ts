// FIRST, deliberately. This module's top-level await runs the pending
// migrations, and hooks.server.ts only evaluates once every import has
// settled -- so `handle` cannot serve a request against a database whose
// schema has not been brought up to date.
import '$lib/server/migrate';
import { auth } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { building } from '$app/environment';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.session = await auth.api.getSession({ headers: event.request.headers });
	return svelteKitHandler({ event, resolve, auth, building });
};
