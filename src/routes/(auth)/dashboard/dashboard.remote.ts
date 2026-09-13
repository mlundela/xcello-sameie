import { query } from '$app/server';
import { db } from '$lib/server/db';
import { requireOrgId } from '$lib/server/tenant';
import { expectedRentByOwner } from '$lib/server/rent';
import { inYear } from '$lib/server/period';
import { accountingPeriod, bankTransaction } from '$lib/schema';
import { eq, and, sum, inArray } from 'drizzle-orm';

export const get_dashboard_data = query(async () => {
	const orgId = requireOrgId();

	// Oldest OPEN period
	const [period] = await db
		.select()
		.from(accountingPeriod)
		.where(and(eq(accountingPeriod.organizationId, orgId), eq(accountingPeriod.status, 'OPEN')))
		.orderBy(accountingPeriod.year)
		.limit(1);

	if (!period) return { period: null, rows: [] };

	const { ownerships, expected } = await expectedRentByOwner(orgId, period.year);
	if (ownerships.length === 0) return { period, rows: [] };

	// Sum of MATCHED transactions per owner for the period year
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
				inYear(bankTransaction.date, period.year),
				inArray(bankTransaction.matchedOwnerId, [...expected.keys()])
			)
		)
		.groupBy(bankTransaction.matchedOwnerId);

	const payments = new Map(paymentRows.map((r) => [r.matchedOwnerId, Number(r.total ?? 0)]));

	// One row per payment-responsible owner, ordered by their lowest section number
	const owners = new Map<string, { ownerName: string; flatNos: string[]; minNummer: number }>();
	for (const o of ownerships) {
		const row = owners.get(o.ownerId);
		if (!row) owners.set(o.ownerId, { ownerName: o.ownerName, flatNos: [o.flatNo], minNummer: o.nummer });
		else {
			if (!row.flatNos.includes(o.flatNo)) row.flatNos.push(o.flatNo);
			row.minNummer = Math.min(row.minNummer, o.nummer);
		}
	}

	const rows = [...owners.entries()]
		.sort(([, a], [, b]) => a.minNummer - b.minNummer)
		.map(([ownerId, o]) => {
			const expectedOre = expected.get(ownerId) ?? 0;
			const actualOre = payments.get(ownerId) ?? 0;
			return {
				ownerId,
				ownerName: o.ownerName,
				flatNos: o.flatNos,
				expectedOre,
				actualOre,
				balanceOre: actualOre - expectedOre
			};
		});

	return { period, rows };
});
