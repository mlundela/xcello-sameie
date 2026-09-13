import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { accountingPeriod } from '$lib/schema';
import { eq, and, asc } from 'drizzle-orm';
import { auth } from '$lib/server/auth';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ request }) => {
	const session = await auth.api.getSession({ headers: request.headers });
	const orgId = session?.session.activeOrganizationId;
	const [first] = await db
		.select({ year: accountingPeriod.year })
		.from(accountingPeriod)
		.where(and(eq(accountingPeriod.organizationId, orgId!), eq(accountingPeriod.status, 'OPEN')))
		.orderBy(asc(accountingPeriod.year))
		.limit(1);
	redirect(302, `/transaksjoner/${first?.year ?? new Date().getFullYear()}`);
};
