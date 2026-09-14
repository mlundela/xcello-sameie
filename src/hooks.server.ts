// FIRST, deliberately. This module's top-level await runs the pending
// migrations, and hooks.server.ts only evaluates once every import has
// settled -- so `handle` cannot serve a request against a database whose
// schema has not been brought up to date.
import '$lib/server/migrate';
import { auth } from '$lib/server/auth';
import { ensureActiveMembership } from '$lib/server/tenant';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { isAPIError } from 'better-auth/api';
import { building } from '$app/environment';
import type { Handle, HandleServerError } from '@sveltejs/kit';

// Expected failures use error() from @sveltejs/kit and never reach this hook.
export const handleError: HandleServerError = ({ error, status }) => {
	// better-auth's messages are written for the user, e.g. "User is already a member of this organization"
	if (isAPIError(error)) return { message: error.body?.message ?? error.message };
	if (status === 404) return { message: 'Siden finnes ikke' };
	console.error(error);
	return { message: 'Noe gikk galt. Prøv igjen.' };
};

// Pages also get a CSP (svelte.config.js). These apply to every response, receipts, PDFs and the auth API included.
const securityHeaders = {
	'Referrer-Policy': 'same-origin',
	'X-Content-Type-Options': 'nosniff',
	'X-Frame-Options': 'DENY',
	'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()'
};

export const handle: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });
	event.locals.role = null;
	if (session && !event.url.pathname.startsWith('/api/auth')) {
		event.locals.role = await ensureActiveMembership(session, event.request.headers);
	}
	event.locals.session = session;
	if (event.url.pathname.startsWith('/api/auth')) {
		// better-auth rate-limits per client IP from this header (see auth.ts). Overwriting it means a
		// client can't choose its bucket; behind a proxy, adapter-node reads ADDRESS_HEADER instead.
		event.request.headers.set('x-client-address', event.getClientAddress());
	}
	const response = await svelteKitHandler({ event, resolve, auth, building });
	for (const [name, value] of Object.entries(securityHeaders)) response.headers.set(name, value);
	return response;
};
