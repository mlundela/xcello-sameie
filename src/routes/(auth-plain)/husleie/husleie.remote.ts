import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { flat, flatRent } from '$lib/schema';
import { and, eq, isNull, desc } from 'drizzle-orm';
import { generateId } from 'better-auth';

async function getOrgId() {
	const event = getRequestEvent();
	const session = await auth.api.getSession({ headers: event.request.headers });
	if (!session) throw new Error('Unauthorized');
	const activeOrgId = session.session.activeOrganizationId;
	if (!activeOrgId) throw new Error('No active organization');
	return activeOrgId;
}

export const get_husleie = query(async () => {
	const orgId = await getOrgId();

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
		await getOrgId();

		let toMonth = fromMonth - 1;
		let toYear = fromYear;
		if (toMonth === 0) {
			toMonth = 12;
			toYear = fromYear - 1;
		}

		await db.transaction(async (tx) => {
			for (const { flatId, amountKr } of rents) {
				const [openEntry] = await tx
					.select()
					.from(flatRent)
					.where(and(eq(flatRent.flatId, flatId), isNull(flatRent.toYear)))
					.limit(1);

				if (openEntry) {
					await tx
						.update(flatRent)
						.set({ toYear, toMonth })
						.where(eq(flatRent.id, openEntry.id));
				}

				await tx.insert(flatRent).values({
					id: generateId(),
					flatId,
					fromYear,
					fromMonth,
					toYear: null,
					toMonth: null,
					amount: amountKr * 100
				});
			}
		});
	}
);
