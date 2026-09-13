import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { flat, flatOwnership, flatRent, owner } from '$lib/schema';
import { and, eq, desc } from 'drizzle-orm';

async function getOrgId() {
	const event = getRequestEvent();
	const session = await auth.api.getSession({ headers: event.request.headers });
	if (!session) throw new Error('Unauthorized');
	const activeOrgId = session.session.activeOrganizationId;
	if (!activeOrgId) throw new Error('No active organization');
	return activeOrgId;
}

export const get_flat = query(v.object({ flatNo: v.string() }), async ({ flatNo }) => {
	const orgId = await getOrgId();

	const [flatRow] = await db
		.select()
		.from(flat)
		.where(and(eq(flat.organizationId, orgId), eq(flat.flatNo, flatNo)))
		.limit(1);

	if (!flatRow) throw new Error('Ikke funnet');

	const history = await db
		.select({ ownership: flatOwnership, owner })
		.from(flatOwnership)
		.innerJoin(owner, eq(owner.id, flatOwnership.ownerId))
		.where(eq(flatOwnership.flatId, flatRow.id))
		.orderBy(desc(flatOwnership.fromDate));

	const rentHistory = await db
		.select()
		.from(flatRent)
		.where(eq(flatRent.flatId, flatRow.id))
		.orderBy(desc(flatRent.fromYear), desc(flatRent.fromMonth));

	return { flat: flatRow, history, rentHistory };
});

export const set_payment_responsible = command(
	v.object({ flatNo: v.string(), ownerId: v.string() }),
	async ({ flatNo, ownerId }) => {
		const orgId = await getOrgId();
		const [flatRow] = await db
			.select({ id: flat.id })
			.from(flat)
			.where(and(eq(flat.organizationId, orgId), eq(flat.flatNo, flatNo)))
			.limit(1);
		if (!flatRow) throw new Error('Ikke funnet');
		await db
			.update(flatOwnership)
			.set({ isPaymentResponsible: false })
			.where(eq(flatOwnership.flatId, flatRow.id));
		await db
			.update(flatOwnership)
			.set({ isPaymentResponsible: true })
			.where(and(eq(flatOwnership.flatId, flatRow.id), eq(flatOwnership.ownerId, ownerId)));
		await get_flat({ flatNo }).refresh();
	}
);
