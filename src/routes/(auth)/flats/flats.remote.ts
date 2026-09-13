import { query, getRequestEvent } from '$app/server';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { flat, flatOwnership, owner, flatRent } from '$lib/schema';
import { and, eq, isNull } from 'drizzle-orm';

async function getOrgId() {
	const event = getRequestEvent();
	const session = await auth.api.getSession({ headers: event.request.headers });
	if (!session) throw new Error('Unauthorized');

	const activeOrgId = session.session.activeOrganizationId;
	if (!activeOrgId) throw new Error('No active organization');

	return activeOrgId;
}

export const get_flats = query(async () => {
	const orgId = await getOrgId();

	const rows = await db
		.select({ flat, ownership: flatOwnership, owner })
		.from(flat)
		.leftJoin(flatOwnership, eq(flatOwnership.flatId, flat.id))
		.leftJoin(owner, eq(owner.id, flatOwnership.ownerId))
		.where(eq(flat.organizationId, orgId))
		.orderBy(flat.nummer);

	const currentRents = await db
		.select({ flatId: flatRent.flatId, amount: flatRent.amount })
		.from(flatRent)
		.innerJoin(flat, eq(flat.id, flatRent.flatId))
		.where(and(eq(flat.organizationId, orgId), isNull(flatRent.toYear)));

	const rentMap = new Map(currentRents.map((r) => [r.flatId, r.amount]));

	const byFlat = new Map<string, (typeof rows)[0]['flat'] & { owners: { ownership: typeof rows[0]['ownership']; owner: typeof rows[0]['owner'] }[]; currentRentAmount: number | null }>();
	for (const row of rows) {
		if (!byFlat.has(row.flat.id)) {
			byFlat.set(row.flat.id, { ...row.flat, owners: [], currentRentAmount: rentMap.get(row.flat.id) ?? null });
		}
		if (row.owner) {
			byFlat.get(row.flat.id)!.owners.push({ ownership: row.ownership, owner: row.owner });
		}
	}

	return [...byFlat.values()];
});
