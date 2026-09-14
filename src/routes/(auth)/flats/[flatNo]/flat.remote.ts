import { error } from '@sveltejs/kit';
import { query, command } from '$app/server';
import * as v from 'valibot';
import { generateId } from 'better-auth';
import { db } from '$lib/server/db';
import { requireAdmin, requireOrgId } from '$lib/server/tenant';
import { flat, flatOwnership, flatRent, matchingRule, owner } from '$lib/schema';
import { and, eq, desc, isNull, inArray } from 'drizzle-orm';

async function findFlat(orgId: string, flatNo: string) {
	const [flatRow] = await db
		.select()
		.from(flat)
		.where(and(eq(flat.organizationId, orgId), eq(flat.flatNo, flatNo)))
		.limit(1);
	if (!flatRow) error(404, 'Ikke funnet');
	return flatRow;
}

export const get_flat = query(v.object({ flatNo: v.string() }), async ({ flatNo }) => {
	const orgId = requireOrgId();
	const flatRow = await findFlat(orgId, flatNo);

	const history = await db
		.select({ ownership: flatOwnership, owner })
		.from(flatOwnership)
		.innerJoin(owner, eq(owner.id, flatOwnership.ownerId))
		.where(eq(flatOwnership.flatId, flatRow.id))
		.orderBy(desc(flatOwnership.fromDate));

	const rentHistory = await db
		.select()
		.from(flatRent)
		.where(eq(flatRent.flatId, flatRow.id))
		.orderBy(desc(flatRent.fromYear), desc(flatRent.fromMonth));

	return { flat: flatRow, history, rentHistory };
});

export const set_payment_responsible = command(
	v.object({ flatNo: v.string(), ownerId: v.string() }),
	async ({ flatNo, ownerId }) => {
		const orgId = requireAdmin();
		const flatRow = await findFlat(orgId, flatNo);
		// Current ownerships only: an old ownership of the same person must not be flagged
		const current = and(eq(flatOwnership.flatId, flatRow.id), isNull(flatOwnership.toDate));
		await db.transaction(async (tx) => {
			await tx.update(flatOwnership).set({ isPaymentResponsible: false }).where(current);
			const updated = await tx
				.update(flatOwnership)
				.set({ isPaymentResponsible: true })
				.where(and(current, eq(flatOwnership.ownerId, ownerId)))
				.returning({ id: flatOwnership.id });
			if (updated.length === 0) error(404, 'Eieren eier ikke denne leiligheten');
		});
		// The page refreshes get_flat via .updates()
	}
);

function dayBefore(isoDate: string): string {
	const d = new Date(`${isoDate}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() - 1);
	return d.toISOString().slice(0, 10);
}

/**
 * Records a sale: the current ownerships end the day before `date` and the new owners take over
 * from `date`. Felleskostnader for a month are owed by whoever owns the flat on the 1st (see
 * $lib/server/rent.ts), so a sale on the 16th leaves that month with the seller.
 * Owners are matched on national/organisation id so a returning owner isn't duplicated.
 */
export const record_ownership_change = command(
	v.object({
		flatNo: v.string(),
		date: v.pipe(v.string(), v.isoDate()),
		owners: v.pipe(
			v.array(
				v.object({
					name: v.pipe(v.string(), v.trim(), v.minLength(1)),
					publicId: v.optional(v.pipe(v.string(), v.trim())),
					shareNumerator: v.pipe(v.number(), v.integer(), v.minValue(1)),
					shareDenominator: v.pipe(v.number(), v.integer(), v.minValue(1))
				})
			),
			v.minLength(1)
		),
		paymentResponsible: v.pipe(v.number(), v.integer(), v.minValue(0))
	}),
	async ({ flatNo, date, owners: newOwners, paymentResponsible }) => {
		const orgId = requireAdmin();
		const flatRow = await findFlat(orgId, flatNo);

		if (paymentResponsible >= newOwners.length) error(400, 'Velg hvem som er betalingsansvarlig');
		const shareSum = newOwners.reduce((s, o) => s + o.shareNumerator / o.shareDenominator, 0);
		if (Math.abs(shareSum - 1) > 1e-9) error(400, 'Eierandelene må til sammen utgjøre hele leiligheten');

		await db.transaction(async (tx) => {
			const current = await tx
				.select({ id: flatOwnership.id, fromDate: flatOwnership.fromDate })
				.from(flatOwnership)
				.where(and(eq(flatOwnership.flatId, flatRow.id), isNull(flatOwnership.toDate)));
			const latestStart = current.map((c) => c.fromDate).sort().at(-1);
			if (latestStart && date <= latestStart) {
				error(400, `Eierskiftet må være etter at nåværende eier overtok (${latestStart})`);
			}

			if (current.length > 0) {
				// Only the end date: who paid while they owned it is history the rent calculation still needs
				await tx
					.update(flatOwnership)
					.set({ toDate: dayBefore(date) })
					.where(inArray(flatOwnership.id, current.map((c) => c.id)));
			}

			const knownIds = newOwners.map((o) => o.publicId).filter((id): id is string => !!id);
			const existing = knownIds.length
				? await tx
						.select({ id: owner.id, publicId: owner.publicId })
						.from(owner)
						.where(and(eq(owner.organizationId, orgId), inArray(owner.publicId, knownIds)))
				: [];
			const byPublicId = new Map(existing.map((o) => [o.publicId, o.id]));

			for (const [i, o] of newOwners.entries()) {
				let ownerId = o.publicId ? byPublicId.get(o.publicId) : undefined;
				if (!ownerId) {
					ownerId = generateId();
					// public_id is required and unique per org; owners entered without an id get a local one
					await tx.insert(owner).values({
						id: ownerId,
						organizationId: orgId,
						name: o.name,
						ownerType: 'PERSON',
						publicId: o.publicId || `manuell-${ownerId}`
					});
					// Same name-based matching rule onboarding creates for Matrikkel owners
					// Skipped if a rule with that name already exists (patterns are unique per sameie)
				await tx.insert(matchingRule).values({ id: generateId(), organizationId: orgId, pattern: o.name, ownerId }).onConflictDoNothing();
				}
				await tx.insert(flatOwnership).values({
					id: generateId(),
					flatId: flatRow.id,
					ownerId,
					fromDate: date,
					toDate: null,
					shareNumerator: o.shareNumerator,
					shareDenominator: o.shareDenominator,
					isPaymentResponsible: i === paymentResponsible
				});
			}
		});
		// The page refreshes get_flat via .updates()
	}
);
