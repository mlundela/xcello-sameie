import { auth } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { building } from '$app/environment';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.session = await auth.api.getSession({ headers: event.request.headers });
	return svelteKitHandler({ event, resolve, auth, building });
};
