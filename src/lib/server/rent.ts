import { error } from '@sveltejs/kit';
import { generateId } from 'better-auth';
import { and, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { db } from './db';
import { flat, flatOwnership, flatRent, owner } from '$lib/schema';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Sets a flat's monthly rent (øre) from `fromYear`/`fromMonth` onward without overlapping history:
 * - same start month as the current rate: corrects that rate's amount
 * - later month: closes the current rate the month before and adds the new one
 * - earlier month: refused, since months already covered by the current rate would get two rates
 */
export async function setRentFrom(tx: Tx, flatId: string, fromYear: number, fromMonth: number, amountOre: number) {
	const [current] = await tx
		.select()
		.from(flatRent)
		.where(and(eq(flatRent.flatId, flatId), isNull(flatRent.toYear)))
		.limit(1);
	// Months counted from year 0, so comparisons and "the month before" are plain arithmetic
	const start = fromYear * 12 + fromMonth - 1;

	if (current) {
		const currentStart = current.fromYear * 12 + current.fromMonth - 1;
		if (start === currentStart) {
			await tx.update(flatRent).set({ amount: amountOre }).where(eq(flatRent.id, current.id));
			return;
		}
		if (start < currentStart) {
			const [f] = await tx.select({ flatNo: flat.flatNo }).from(flat).where(eq(flat.id, flatId));
			error(400, `Ny sats for ${f?.flatNo ?? 'leiligheten'} kan ikke starte før gjeldende sats (fra ${String(current.fromMonth).padStart(2, '0')}.${current.fromYear})`);
		}
		const lastMonth = start - 1;
		await tx
			.update(flatRent)
			.set({ toYear: Math.floor(lastMonth / 12), toMonth: (lastMonth % 12) + 1 })
			.where(eq(flatRent.id, current.id));
	}

	await tx.insert(flatRent).values({ id: generateId(), flatId, fromYear, fromMonth, toYear: null, toMonth: null, amount: amountOre });
}

type Rent = Pick<typeof flatRent.$inferSelect, 'flatId' | 'fromYear' | 'fromMonth' | 'toYear' | 'toMonth' | 'amount'>;

export function rentForMonth(rents: Rent[], flatId: string, year: number, month: number): number {
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
export function monthsDue(year: number, today: Date): number {
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
