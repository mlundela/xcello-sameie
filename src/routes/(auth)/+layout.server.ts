import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.session) redirect(302, '/login');
	if (!locals.session.session.activeOrganizationId) redirect(302, '/organizations/new');
	return { session: locals.session };
};
