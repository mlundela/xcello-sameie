import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { bankTransaction, owner, flatOwnership, flat, voucher, voucherLine, ledgerAccount } from '$lib/schema';
import { eq, and, sql, isNull, or, gte, inArray } from 'drizzle-orm';
import { createOpeningVoucher, readOpeningState } from '$lib/server/voucher';

async function getOrgId() {
	const event = getRequestEvent();
	const session = await auth.api.getSession({ headers: event.request.headers });
	if (!session) throw new Error('Unauthorized');
	const activeOrgId = session.session.activeOrganizationId;
	if (!activeOrgId) throw new Error('No active organization');
	return activeOrgId;
}

export const get_rapport_years = query(async () => {
	const orgId = await getOrgId();
	const rows = await db
		.selectDistinct({
			year: sql<number>`EXTRACT(YEAR FROM ${bankTransaction.date}::date)::integer`
		})
		.from(bankTransaction)
		.where(eq(bankTransaction.organizationId, orgId))
		.orderBy(sql`1 DESC`);
	return rows.map((r) => r.year);
});

export const get_opening_balance = query(
	v.object({ year: v.pipe(v.number(), v.integer()) }),
	async ({ year }) => {
		const orgId = await getOrgId();
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
		const orgId = await getOrgId();
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
		const orgId = await getOrgId();

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
		const orgId = await getOrgId();
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
