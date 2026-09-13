import { error } from '@sveltejs/kit';
import { query, command } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import { requireOrgId } from '$lib/server/tenant';
import { flat, flatOwnership, flatRent, owner } from '$lib/schema';
import { and, eq, desc } from 'drizzle-orm';

export const get_flat = query(v.object({ flatNo: v.string() }), async ({ flatNo }) => {
	const orgId = requireOrgId();

	const [flatRow] = await db
		.select()
		.from(flat)
		.where(and(eq(flat.organizationId, orgId), eq(flat.flatNo, flatNo)))
		.limit(1);

	if (!flatRow) error(404, 'Ikke funnet');

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
		const orgId = requireOrgId();
		const [flatRow] = await db
			.select({ id: flat.id })
			.from(flat)
			.where(and(eq(flat.organizationId, orgId), eq(flat.flatNo, flatNo)))
			.limit(1);
		if (!flatRow) error(404, 'Ikke funnet');
		await db.transaction(async (tx) => {
			await tx
				.update(flatOwnership)
				.set({ isPaymentResponsible: false })
				.where(eq(flatOwnership.flatId, flatRow.id));
			const updated = await tx
				.update(flatOwnership)
				.set({ isPaymentResponsible: true })
				.where(and(eq(flatOwnership.flatId, flatRow.id), eq(flatOwnership.ownerId, ownerId)))
				.returning({ id: flatOwnership.id });
			if (updated.length === 0) error(404, 'Eieren eier ikke denne leiligheten');
		});
		await get_flat({ flatNo }).refresh();
	}
);
