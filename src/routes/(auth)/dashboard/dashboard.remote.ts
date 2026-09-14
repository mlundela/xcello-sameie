import { query } from '$app/server';
import * as v from 'valibot';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { requireOrgId } from '$lib/server/tenant';
import { ownerLedger, syncOpeningBalances } from '$lib/server/balances';
import { accountingPeriod, owner } from '$lib/schema';

export const get_dashboard_data = query(
	v.object({ year: v.optional(v.pipe(v.number(), v.integer())) }),
	async ({ year }) => {
		const orgId = requireOrgId();

		const periods = await db
			.select({ year: accountingPeriod.year, status: accountingPeriod.status })
			.from(accountingPeriod)
			.where(eq(accountingPeriod.organizationId, orgId))
			.orderBy(asc(accountingPeriod.year));
		// Default: the oldest open period, the one still being worked on (as on /transaksjoner)
		const period =
			periods.find((p) => p.year === year) ?? periods.find((p) => p.status === 'OPEN') ?? periods.at(-1) ?? null;
		if (!period) return { periods, period: null, rows: [] };

		await syncOpeningBalances(orgId);
		// Same figures as the balance report, so the two can't disagree
		const { ownerships, owners } = await ownerLedger(orgId, period.year);

		const info = new Map<string, { ownerName: string; flatNos: string[]; minNummer: number }>();
		for (const o of ownerships) {
			const row = info.get(o.ownerId);
			if (!row) info.set(o.ownerId, { ownerName: o.ownerName, flatNos: [o.flatNo], minNummer: o.nummer });
			else {
				if (!row.flatNos.includes(o.flatNo)) row.flatNos.push(o.flatNo);
				row.minNummer = Math.min(row.minNummer, o.nummer);
			}
		}

		// Former owners who still have a balance this year (e.g. a seller who left with arrears)
		const formerIds = owners.filter((o) => !info.has(o.ownerId) && o.balanceOre !== 0).map((o) => o.ownerId);
		if (formerIds.length > 0) {
			const former = await db
				.select({ id: owner.id, name: owner.name })
				.from(owner)
				.where(and(eq(owner.organizationId, orgId), inArray(owner.id, formerIds)));
			for (const o of former) info.set(o.id, { ownerName: o.name, flatNos: [], minNummer: Number.MAX_SAFE_INTEGER });
		}

		const rows = owners
			.filter((o) => info.has(o.ownerId))
			.map((o) => ({ ...o, ...info.get(o.ownerId)! }))
			.sort((a, b) => a.minNummer - b.minNummer)
			.map(({ minNummer, ...row }) => row);

		return { periods, period, rows };
	}
);
