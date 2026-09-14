import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { accountingPeriod } from '$lib/schema';
import { eq, asc } from 'drizzle-orm';
import { requireOrgId } from '$lib/server/tenant';
import type { PageServerLoad } from './$types';

// The current calendar year, else the latest period: the same year the dashboard shows
export const load: PageServerLoad = async () => {
	const orgId = requireOrgId();
	const years = (
		await db.select({ year: accountingPeriod.year }).from(accountingPeriod).where(eq(accountingPeriod.organizationId, orgId)).orderBy(asc(accountingPeriod.year))
	).map((p) => p.year);
	const thisYear = new Date().getFullYear();
	redirect(302, `/transaksjoner/${years.includes(thisYear) ? thisYear : (years.at(-1) ?? thisYear)}`);
};
