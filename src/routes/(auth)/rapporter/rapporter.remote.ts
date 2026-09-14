import { query, command, requested } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import { assertInOrg, requireAdmin, requireOrgId } from '$lib/server/tenant';
import { accountingPeriod, owner, flatOwnership, flat } from '$lib/schema';
import { eq, and, isNull, or, gte, desc, inArray } from 'drizzle-orm';
import { createOpeningVoucher, readOpeningState } from '$lib/server/voucher';
import { syncOpeningBalances } from '$lib/server/balances';
import { error } from '@sveltejs/kit';
import { generateId } from 'better-auth';

// From accounting periods, not bank transactions: a new sameie must be able to enter its
// opening balance before the first CSV import.
export const get_rapport_years = query(async () => {
	const orgId = requireOrgId();
	// The page reads each year's opening balances next; bring them up to date first
	await syncOpeningBalances(orgId);
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

/** Only a sameie's first year has opening balances of its own; later years follow the year before. */
async function assertFirstYear(orgId: string, year: number) {
	const [previous] = await db
		.select({ year: accountingPeriod.year })
		.from(accountingPeriod)
		.where(and(eq(accountingPeriod.organizationId, orgId), eq(accountingPeriod.year, year - 1)));
	if (previous) error(409, `Inngående saldo for ${year} hentes automatisk fra utgående saldo ${year - 1}`);
}

/** After the first year's opening balances change, every later year's do too. */
async function syncAndRefreshAllYears(orgId: string) {
	await syncOpeningBalances(orgId);
	const years = await db.select({ year: accountingPeriod.year }).from(accountingPeriod).where(eq(accountingPeriod.organizationId, orgId));
	await Promise.all(years.flatMap(({ year }) => [get_opening_balance({ year }).refresh(), get_owner_opening_balances({ year }).refresh()]));
}

export const set_opening_balance = command(
	v.object({
		year: v.pipe(v.number(), v.integer()),
		bankOre: v.number(),
		loanOre: v.number()
	}),
	async ({ year, bankOre, loanOre }) => {
		const orgId = requireAdmin();
		await assertFirstYear(orgId, year);
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
		await syncAndRefreshAllYears(orgId);
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

		// Former owners carried over with a balance (e.g. a seller who left with arrears) have no
		// ownership this year but must stay visible and editable
		const formerIds = [...storedMap.keys()].filter((id) => !ownerMap.has(id));
		if (formerIds.length > 0) {
			const former = await db
				.select({ id: owner.id, name: owner.name })
				.from(owner)
				.where(and(eq(owner.organizationId, orgId), inArray(owner.id, formerIds)));
			for (const o of former) ownerMap.set(o.id, { ownerName: o.name, flatNos: [] });
		}

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
		await assertFirstYear(orgId, year);
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
		await syncAndRefreshAllYears(orgId);
	}
);

/**
 * Starts the year after the latest accounting period; its opening balances follow that year's
 * closing balances from then on. Only one year ahead of the calendar, so January's statement
 * can be imported before anything else happens.
 */
export const open_next_year = command(v.object({}), async () => {
	const orgId = requireAdmin();
	const [latest] = await db
		.select({ year: accountingPeriod.year })
		.from(accountingPeriod)
		.where(eq(accountingPeriod.organizationId, orgId))
		.orderBy(desc(accountingPeriod.year))
		.limit(1);
	if (!latest) error(409, 'Sameiet har ingen regnskapsperioder ennå');
	const year = latest.year + 1;
	if (year > new Date().getFullYear() + 1) error(409, `Regnskapsår ${year} kan ikke startes før ${year - 1}`);

	const created = await db
		.insert(accountingPeriod)
		.values({ id: generateId(), organizationId: orgId, year, status: 'OPEN' })
		.onConflictDoNothing()
		.returning({ id: accountingPeriod.id });
	if (created.length === 0) error(409, `Regnskapsår ${year} finnes allerede`);
	await syncOpeningBalances(orgId);
	await requested(get_rapport_years, 5).refreshAll();
	return { year };
});
