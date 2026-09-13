import { error } from '@sveltejs/kit';
import { query, command } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import { assertInOrg, requireAdmin, requireOrgId } from '$lib/server/tenant';
import { matchingRule, owner, flat, flatOwnership, ledgerAccount } from '$lib/schema';
import { eq, isNull, and } from 'drizzle-orm';
import { generateId } from 'better-auth';

export const get_rules = query(async () => {
	const orgId = requireOrgId();

	// Owner rules and expense (ledger account) rules; exactly one of the two joins matches per row
	const rules = await db
		.select({
			id: matchingRule.id,
			pattern: matchingRule.pattern,
			ownerId: matchingRule.ownerId,
			ownerName: owner.name,
			ledgerAccountId: matchingRule.ledgerAccountId,
			accountCode: ledgerAccount.code,
			accountName: ledgerAccount.name,
			receiptNotRequired: matchingRule.receiptNotRequired,
			userDescription: matchingRule.userDescription
		})
		.from(matchingRule)
		.leftJoin(owner, eq(owner.id, matchingRule.ownerId))
		.leftJoin(ledgerAccount, eq(ledgerAccount.id, matchingRule.ledgerAccountId))
		.where(eq(matchingRule.organizationId, orgId))
		.orderBy(matchingRule.pattern);

	const owners = await db
		.selectDistinct({ id: owner.id, name: owner.name })
		.from(owner)
		.innerJoin(flatOwnership, eq(flatOwnership.ownerId, owner.id))
		.innerJoin(flat, eq(flat.id, flatOwnership.flatId))
		.where(and(eq(flat.organizationId, orgId), isNull(flatOwnership.toDate)))
		.orderBy(owner.name);

	return { rules, owners };
});

export const create_rule = command(
	v.object({
		pattern: v.pipe(v.string(), v.minLength(1)),
		ownerId: v.optional(v.pipe(v.string(), v.minLength(1))),
		ledgerAccountId: v.optional(v.pipe(v.string(), v.minLength(1))),
		receiptNotRequired: v.optional(v.boolean(), false),
		userDescription: v.optional(v.string())
	}),
	async ({ pattern, ownerId, ledgerAccountId, receiptNotRequired, userDescription }) => {
		const orgId = requireAdmin();
		if (!ownerId === !ledgerAccountId) error(400, 'Velg enten en eier eller en konto');
		if (ownerId) await assertInOrg(owner, [ownerId], orgId);
		if (ledgerAccountId) await assertInOrg(ledgerAccount, [ledgerAccountId], orgId);
		await db.insert(matchingRule).values({
			id: generateId(),
			organizationId: orgId,
			pattern,
			ownerId,
			ledgerAccountId,
			receiptNotRequired,
			userDescription: userDescription || null
		});
		await get_rules().refresh();
	}
);

export const delete_rule = command(
	v.object({ id: v.string() }),
	async ({ id }) => {
		const orgId = requireAdmin();
		await db.delete(matchingRule).where(and(eq(matchingRule.id, id), eq(matchingRule.organizationId, orgId)));
		await get_rules().refresh();
	}
);
