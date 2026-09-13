import { getRequestEvent, query } from '$app/server';
import { auth } from '$lib/server/auth';

export const get_layout_data = query(async () => {
	const event = getRequestEvent();
	const session = await auth.api.getSession({ headers: event.request.headers });
	if (!session) throw new Error('Unauthorized');
	const organizations = await auth.api.listOrganizations({ headers: event.request.headers });
	if (!organizations.length) return { user: session.user, organizations: [], activeOrg: null };
	const activeOrg = await auth.api.getFullOrganization({ headers: event.request.headers });
	return { user: session.user, organizations, activeOrg };
});
