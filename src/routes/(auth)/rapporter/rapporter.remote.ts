import { query, command } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import { assertInOrg, requireAdmin, requireOrgId } from '$lib/server/tenant';
import { accountingPeriod, owner, flatOwnership, flat } from '$lib/schema';
import { eq, and, isNull, or, gte, desc } from 'drizzle-orm';
import { createOpeningVoucher, readOpeningState } from '$lib/server/voucher';

// From accounting periods, not bank transactions: a new sameie must be able to enter its
// opening balance before the first CSV import.
export const get_rapport_years = query(async () => {
	const orgId = requireOrgId();
	const rows = await db
		.select({ year: accountingPeriod.year })
		.from(accountingPeriod)
		.where(eq(accountingPeriod.organizationId, orgId))
		.orderBy(desc(accountingPeriod.year));
	return rows.map((r) => r.year);
});

export const get_opening_balance = query(
	v.object({ year: v.pipe(v.number(), v.integer()) }),
	async ({ year }) => {
		const orgId = requireOrgId();
		const state = await readOpeningState(db, orgId, year);
		if (!state) return null;
		return { year, bankOre: state.bankOre, loanOre: state.loanOre };
	}
);

export const set_opening_balance = command(
	v.object({
		year: v.pipe(v.number(), v.integer()),
		bankOre: v.number(),
		loanOre: v.number()
	}),
	async ({ year, bankOre, loanOre }) => {
		const orgId = requireAdmin();
		await db.transaction(async (tx) => {
			const current = await readOpeningState(tx, orgId, year);
			await createOpeningVoucher(tx, {
				organizationId: orgId,
				year,
				bankOre,
				loanOre,
				ownerBalances: current?.ownerBalances ?? []
			});
		});
		await get_opening_balance({ year }).refresh();
	}
);

export const get_owner_opening_balances = query(
	v.object({ year: v.pipe(v.number(), v.integer()) }),
	async ({ year }) => {
		const orgId = requireOrgId();

		// All payment-responsible owners active at any point in the year
		const ownerships = await db
			.select({ ownerId: owner.id, ownerName: owner.name, flatNo: flat.flatNo })
			.from(flatOwnership)
			.innerJoin(flat, eq(flat.id, flatOwnership.flatId))
			.innerJoin(owner, eq(owner.id, flatOwnership.ownerId))
			.where(
				and(
					eq(flat.organizationId, orgId),
					eq(flatOwnership.isPaymentResponsible, true),
					or(isNull(flatOwnership.toDate), gte(flatOwnership.toDate, `${year}-01-01`))
				)
			);

		// Deduplicate by ownerId
		const ownerMap = new Map<string, { ownerName: string; flatNos: string[] }>();
		for (const o of ownerships) {
			const existing = ownerMap.get(o.ownerId);
			if (existing) existing.flatNos.push(o.flatNo);
			else ownerMap.set(o.ownerId, { ownerName: o.ownerName, flatNos: [o.flatNo] });
		}

		// Read from OPENING voucher
		const state = await readOpeningState(db, orgId, year);
		const storedMap = new Map(state?.ownerBalances.map((r) => [r.ownerId, r.balanceOre]) ?? []);

		return [...ownerMap.entries()].map(([ownerId, data]) => ({
			ownerId,
			ownerName: data.ownerName,
			flatNos: data.flatNos,
			balanceOre: storedMap.get(ownerId) ?? 0
		}));
	}
);

export const set_owner_opening_balance = command(
	v.object({
		year: v.pipe(v.number(), v.integer()),
		ownerId: v.pipe(v.string(), v.minLength(1)),
		balanceOre: v.number()
	}),
	async ({ year, ownerId, balanceOre }) => {
		const orgId = requireAdmin();
		await assertInOrg(owner, [ownerId], orgId);
		await db.transaction(async (tx) => {
			const current = await readOpeningState(tx, orgId, year);
			const ownerBalances = (current?.ownerBalances ?? []).filter((o) => o.ownerId !== ownerId);
			if (balanceOre !== 0) ownerBalances.push({ ownerId, balanceOre });
			await createOpeningVoucher(tx, {
				organizationId: orgId,
				year,
				bankOre: current?.bankOre ?? 0,
				loanOre: current?.loanOre ?? 0,
				ownerBalances
			});
		});
		await get_owner_opening_balances({ year }).refresh();
	}
);
