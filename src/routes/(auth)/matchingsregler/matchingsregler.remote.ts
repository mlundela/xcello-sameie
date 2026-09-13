import { query, command } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import { requireOrgId } from '$lib/server/tenant';
import { matchingRule, owner, flat, flatOwnership } from '$lib/schema';
import { eq, isNull, and } from 'drizzle-orm';
import { generateId } from 'better-auth';

export const get_rules = query(async () => {
	const orgId = requireOrgId();

	const rules = await db
		.select({
			id: matchingRule.id,
			pattern: matchingRule.pattern,
			ownerId: matchingRule.ownerId,
			ownerName: owner.name
		})
		.from(matchingRule)
		.innerJoin(owner, eq(owner.id, matchingRule.ownerId))
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
		ownerId: v.pipe(v.string(), v.minLength(1))
	}),
	async ({ pattern, ownerId }) => {
		const orgId = requireOrgId();
		await db.insert(matchingRule).values({ id: generateId(), organizationId: orgId, pattern, ownerId });
		await get_rules().refresh();
	}
);

export const delete_rule = command(
	v.object({ id: v.string() }),
	async ({ id }) => {
		requireOrgId();
		await db.delete(matchingRule).where(eq(matchingRule.id, id));
		await get_rules().refresh();
	}
);
