import { getRequestEvent, query } from '$app/server';
import { auth } from '$lib/server/auth';
import { requireSession } from '$lib/server/tenant';

export const get_layout_data = query(async () => {
	const session = requireSession();
	const { headers } = getRequestEvent().request;
	const organizations = await auth.api.listOrganizations({ headers });
	if (!organizations.length) return { user: session.user, organizations: [], activeOrg: null };
	const activeOrg = await auth.api.getFullOrganization({ headers });
	return { user: session.user, organizations, activeOrg };
});
