import { and, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { db } from './db';
import { flat, flatOwnership, flatRent, owner } from '$lib/schema';

type Rent = Pick<typeof flatRent.$inferSelect, 'flatId' | 'fromYear' | 'fromMonth' | 'toYear' | 'toMonth' | 'amount'>;

function rentForMonth(rents: Rent[], flatId: string, year: number, month: number): number {
	const rent = rents.find((r) => {
		if (r.flatId !== flatId) return false;
		const fromOk = r.fromYear < year || (r.fromYear === year && r.fromMonth <= month);
		const toOk =
			r.toYear === null ||
			r.toYear > year ||
			(r.toYear === year && r.toMonth !== null && r.toMonth >= month);
		return fromOk && toOk;
	});
	return rent?.amount ?? 0;
}

/** Months of `year` that have fallen due: all 12 for past years, none for future ones. */
function monthsDue(year: number, today: Date): number {
	if (year < today.getFullYear()) return 12;
	if (year > today.getFullYear()) return 0;
	return today.getMonth() + 1;
}

/**
 * Expected felleskostnader (øre) per payment-responsible owner for the months of `year` due so far.
 *
 * Felleskostnader fall due on the 1st, so a month is owed by the ownership covering the 1st:
 * on a mid-month sale the seller owes that month and the buyer starts the next. If ownership
 * rows overlap, the most recent one wins, so each flat-month is counted exactly once.
 */
export async function expectedRentByOwner(organizationId: string, year: number, today = new Date()) {
	const ownerships = await db
		.select({
			ownerId: owner.id,
			ownerName: owner.name,
			flatId: flat.id,
			flatNo: flat.flatNo,
			nummer: flat.nummer,
			fromDate: flatOwnership.fromDate,
			toDate: flatOwnership.toDate
		})
		.from(flatOwnership)
		.innerJoin(flat, eq(flat.id, flatOwnership.flatId))
		.innerJoin(owner, eq(owner.id, flatOwnership.ownerId))
		.where(
			and(
				eq(flat.organizationId, organizationId),
				eq(flatOwnership.isPaymentResponsible, true),
				lte(flatOwnership.fromDate, `${year}-12-31`),
				or(isNull(flatOwnership.toDate), gte(flatOwnership.toDate, `${year}-01-01`))
			)
		);

	const flatIds = [...new Set(ownerships.map((o) => o.flatId))];
	const rents = flatIds.length
		? await db
				.select({
					flatId: flatRent.flatId,
					fromYear: flatRent.fromYear,
					fromMonth: flatRent.fromMonth,
					toYear: flatRent.toYear,
					toMonth: flatRent.toMonth,
					amount: flatRent.amount
				})
				.from(flatRent)
				.where(inArray(flatRent.flatId, flatIds))
		: [];

	const expected = new Map(ownerships.map((o) => [o.ownerId, 0]));
	for (const flatId of flatIds) {
		for (let month = 1; month <= monthsDue(year, today); month++) {
			const first = `${year}-${String(month).padStart(2, '0')}-01`;
			let payer: (typeof ownerships)[number] | undefined;
			for (const o of ownerships) {
				if (o.flatId !== flatId || o.fromDate > first || (o.toDate !== null && o.toDate < first)) continue;
				if (!payer || o.fromDate > payer.fromDate) payer = o;
			}
			if (payer) expected.set(payer.ownerId, expected.get(payer.ownerId)! + rentForMonth(rents, flatId, year, month));
		}
	}

	return { ownerships, expected };
}
