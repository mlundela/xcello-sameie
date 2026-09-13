import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

// Guard only. Don't return locals.session: it contains the session token, which would be serialized into the page.
export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.session) redirect(302, '/login');
	if (!locals.session.session.activeOrganizationId) redirect(302, '/organizations/new');
};
