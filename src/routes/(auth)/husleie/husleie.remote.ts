import { query, command } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import { assertInOrg, requireAdmin, requireOrgId } from '$lib/server/tenant';
import { setRentFrom } from '$lib/server/rent';
import { flat, flatRent } from '$lib/schema';
import { eq, desc } from 'drizzle-orm';

export const get_husleie = query(async () => {
	const orgId = requireOrgId();

	const flats = await db
		.select()
		.from(flat)
		.where(eq(flat.organizationId, orgId))
		.orderBy(flat.nummer);

	const allRents = await db
		.select({
			id: flatRent.id,
			flatId: flatRent.flatId,
			fromYear: flatRent.fromYear,
			fromMonth: flatRent.fromMonth,
			toYear: flatRent.toYear,
			toMonth: flatRent.toMonth,
			amount: flatRent.amount
		})
		.from(flatRent)
		.innerJoin(flat, eq(flat.id, flatRent.flatId))
		.where(eq(flat.organizationId, orgId))
		.orderBy(flat.nummer, desc(flatRent.fromYear), desc(flatRent.fromMonth));

	return flats.map((f) => {
		const history = allRents.filter((r) => r.flatId === f.id);
		const current = history.find((r) => r.toYear === null) ?? null;
		return {
			...f,
			currentRentAmount: current?.amount ?? null,
			rentHistory: history
		};
	});
});

export const set_bulk_rent = command(
	v.object({
		fromYear: v.pipe(v.number(), v.integer()),
		fromMonth: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(12)),
		rents: v.array(
			v.object({
				flatId: v.string(),
				amountKr: v.pipe(v.number(), v.integer(), v.minValue(0))
			})
		)
	}),
	async ({ fromYear, fromMonth, rents }) => {
		const orgId = requireAdmin();
		await assertInOrg(flat, rents.map((r) => r.flatId), orgId);

		// All flats or none: one refused start month rolls back the whole update
		await db.transaction(async (tx) => {
			for (const { flatId, amountKr } of rents) {
				await setRentFrom(tx, flatId, fromYear, fromMonth, amountKr * 100);
			}
		});
	}
);
