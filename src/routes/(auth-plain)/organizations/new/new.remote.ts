import { command, query, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { ADDRESS_ID_PATTERN, auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { assertInOrg, requireAdmin, requireOrgId, requireSession } from '$lib/server/tenant';
import { flat, accountingPeriod, flatOwnership, owner } from '$lib/schema';
import { setRentFrom } from '$lib/server/rent';
import { and, eq, isNull } from 'drizzle-orm';
import { generateId } from 'better-auth';
import { createOpeningVoucher } from '$lib/server/voucher';

export const get_setup_flats = query(async () => {
	const orgId = requireOrgId();
	return db.select().from(flat).where(eq(flat.organizationId, orgId)).orderBy(flat.nummer);
});

export const get_setup_owners = query(async () => {
	const orgId = requireOrgId();
	const rows = await db
		.select({
			ownerId: owner.id,
			ownerName: owner.name,
			flatNo: flat.flatNo,
			nummer: flat.nummer
		})
		.from(flatOwnership)
		.innerJoin(flat, eq(flat.id, flatOwnership.flatId))
		.innerJoin(owner, eq(owner.id, flatOwnership.ownerId))
		.where(and(eq(flat.organizationId, orgId), eq(flatOwnership.isPaymentResponsible, true), isNull(flatOwnership.toDate)))
		.orderBy(flat.nummer);

	// Deduplicate (owner may own multiple flats)
	const seen = new Map<string, { ownerName: string; flatNos: string[] }>();
	for (const r of rows) {
		const e = seen.get(r.ownerId);
		if (e) e.flatNos.push(r.flatNo);
		else seen.set(r.ownerId, { ownerName: r.ownerName, flatNos: [r.flatNo] });
	}
	return [...seen.entries()].map(([ownerId, d]) => ({ ownerId, ownerName: d.ownerName, flatNos: d.flatNos }));
});

export const setup_accounting_periods = command(
	v.object({
		startYear: v.pipe(v.number(), v.integer(), v.minValue(2000)),
		bankOre: v.pipe(v.number(), v.integer()),
		loanOre: v.pipe(v.number(), v.integer()),
		ownerBalances: v.array(v.object({
			ownerId: v.string(),
			balanceOre: v.number()
		}))
	}),
	async ({ startYear, bankOre, loanOre, ownerBalances }) => {
		const orgId = requireAdmin();
		await assertInOrg(owner, ownerBalances.map((o) => o.ownerId), orgId);
		const currentYear = new Date().getFullYear();
		const rows = Array.from({ length: currentYear - startYear + 1 }, (_, i) => ({
			id: generateId(),
			organizationId: orgId,
			year: startYear + i,
			status: 'OPEN' as const
		}));
		await db.transaction(async (tx) => {
			await tx.insert(accountingPeriod).values(rows).onConflictDoNothing();
			await createOpeningVoucher(tx, { organizationId: orgId, year: startYear, bankOre, loanOre, ownerBalances });
		});
	}
);

export const set_initial_rent = command(
	v.object({
		fromYear: v.pipe(v.number(), v.integer()),
		rents: v.array(v.object({
			flatId: v.string(),
			amountKr: v.pipe(v.number(), v.integer(), v.minValue(0))
		}))
	}),
	async ({ fromYear, rents }) => {
		const orgId = requireAdmin();
		await assertInOrg(flat, rents.map((r) => r.flatId), orgId);
		// Saving this step again (going back in the wizard) corrects the rate instead of overlapping it
		await db.transaction(async (tx) => {
			for (const { flatId, amountKr } of rents) {
				await setRentFrom(tx, flatId, fromYear, 1, amountKr * 100);
			}
		});
	}
);

export const create_organization = command(
	v.object({
		orgNo: v.pipe(v.string(), v.regex(/^\d{9}$/)),
		name: v.pipe(v.string(), v.minLength(1)),
		addressId: v.pipe(v.string(), v.regex(ADDRESS_ID_PATTERN)),
		address: v.string(),
		postalCode: v.string(),
		city: v.string()
	}),
	async ({ orgNo, name, addressId, address, postalCode, city }) => {
		requireSession();
		const event = getRequestEvent();

		const slug = `${orgNo}-${Date.now()}`;
		const metadata = { orgNo, addressId, address, postalCode, city };

		const org = await auth.api.createOrganization({
			body: { name, slug, metadata },
			headers: event.request.headers
		});

		await auth.api.setActiveOrganization({
			body: { organizationId: org.id },
			headers: event.request.headers
		});
	}
);
