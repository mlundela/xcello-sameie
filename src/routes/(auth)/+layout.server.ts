import { redirect } from '@sveltejs/kit';
import { canEdit } from '$lib/roles';
import type { LayoutServerLoad } from './$types';

// Guard, plus whether the user may change anything; pages read it as page.data.canEdit to hide
// controls, while requireAdmin() enforces it on the server. Never return locals.session: it
// contains the session token, which would be serialized into the page.
export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.session) redirect(302, '/login');
	if (!locals.session.session.activeOrganizationId) redirect(302, '/organizations/new');
	return { canEdit: canEdit(locals.role) };
};
