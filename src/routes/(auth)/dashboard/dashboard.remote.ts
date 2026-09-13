import { query, getRequestEvent } from '$app/server';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import {
	accountingPeriod,
	flat,
	flatOwnership,
	flatRent,
	bankTransaction,
	owner
} from '$lib/schema';
import { eq, and, isNull, or, gte, sql, sum, inArray } from 'drizzle-orm';

async function getOrgId() {
	const event = getRequestEvent();
	const session = await auth.api.getSession({ headers: event.request.headers });
	if (!session) throw new Error('Unauthorized');
	const activeOrgId = session.session.activeOrganizationId;
	if (!activeOrgId) throw new Error('No active organization');
	return activeOrgId;
}

function findRentForMonth(
	rents: { flatId: string; fromYear: number; fromMonth: number; toYear: number | null; toMonth: number | null; amount: number }[],
	flatId: string,
	year: number,
	month: number
): number {
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

export const get_dashboard_data = query(async () => {
	const orgId = await getOrgId();

	// Oldest OPEN period
	const [period] = await db
		.select()
		.from(accountingPeriod)
		.where(and(eq(accountingPeriod.organizationId, orgId), eq(accountingPeriod.status, 'OPEN')))
		.orderBy(accountingPeriod.year)
		.limit(1);

	if (!period) return { period: null, rows: [] };

	const today = new Date();
	const periodYear = period.year;
	const monthsElapsed = periodYear < today.getFullYear() ? 12 : today.getMonth() + 1;
	const currentMonth = today.getMonth() + 1;

	// Only payment-responsible ownerships for the period year
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
				eq(flat.organizationId, orgId),
				eq(flatOwnership.isPaymentResponsible, true),
				or(
					isNull(flatOwnership.toDate),
					gte(flatOwnership.toDate, `${periodYear}-01-01`)
				)
			)
		);

	if (ownerships.length === 0) return { period, rows: [] };

	const flatIds = [...new Set(ownerships.map((o) => o.flatId))];

	// All relevant flat rents
	const rents = await db
		.select({
			flatId: flatRent.flatId,
			fromYear: flatRent.fromYear,
			fromMonth: flatRent.fromMonth,
			toYear: flatRent.toYear,
			toMonth: flatRent.toMonth,
			amount: flatRent.amount
		})
		.from(flatRent)
		.where(inArray(flatRent.flatId, flatIds));

	// Sum of MATCHED transactions per owner for the period year
	const ownerIds = [...new Set(ownerships.map((o) => o.ownerId))];
	const paymentRows = await db
		.select({
			matchedOwnerId: bankTransaction.matchedOwnerId,
			total: sum(bankTransaction.amountOre)
		})
		.from(bankTransaction)
		.where(
			and(
				eq(bankTransaction.organizationId, orgId),
				eq(bankTransaction.status, 'MATCHED'),
				sql`EXTRACT(YEAR FROM ${bankTransaction.date}::date) = ${periodYear}`,
				inArray(bankTransaction.matchedOwnerId, ownerIds)
			)
		)
		.groupBy(bankTransaction.matchedOwnerId);

	const payments = new Map(
		paymentRows.map((r) => [r.matchedOwnerId, Number(r.total ?? 0)])
	);

	// Aggregate per owner (one row per payment-responsible owner)
	const ownerMap = new Map<
		string,
		{
			ownerName: string;
			flatNos: string[];
			minNummer: number;
			expectedOre: number;
			currentMonthRentOre: number;
		}
	>();

	for (const o of ownerships) {
		let expectedOre = 0;
		for (let m = 1; m <= monthsElapsed; m++) {
			const rent = findRentForMonth(rents, o.flatId, periodYear, m);
			expectedOre += rent;
		}

		const currentRent = findRentForMonth(rents, o.flatId, periodYear, currentMonth);

		const existing = ownerMap.get(o.ownerId);
		if (existing) {
			existing.flatNos.push(o.flatNo);
			existing.expectedOre += expectedOre;
			existing.currentMonthRentOre += currentRent;
			if (o.nummer < existing.minNummer) existing.minNummer = o.nummer;
		} else {
			ownerMap.set(o.ownerId, {
				ownerName: o.ownerName,
				flatNos: [o.flatNo],
				minNummer: o.nummer,
				expectedOre,
				currentMonthRentOre: currentRent
			});
		}
	}

	const rows = [...ownerMap.entries()].map(([ownerId, data]) => {
		const actualOre = payments.get(ownerId) ?? 0;
		const balanceOre = actualOre - data.expectedOre;
		const isWarning = balanceOre < -data.currentMonthRentOre;
		return {
			ownerId,
			ownerName: data.ownerName,
			flatNos: data.flatNos,
			expectedOre: data.expectedOre,
			actualOre,
			balanceOre,
			isWarning
		};
	});

	rows.sort((a, b) => {
		const aMin = ownerMap.get(a.ownerId)!.minNummer;
		const bMin = ownerMap.get(b.ownerId)!.minNummer;
		return aMin - bMin;
	});

	return { period, rows };
});
