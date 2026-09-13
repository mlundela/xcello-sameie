import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { matchingRule, owner, flat, flatOwnership } from '$lib/schema';
import { eq, isNull, and } from 'drizzle-orm';
import { generateId } from 'better-auth';

async function getOrgId() {
	const event = getRequestEvent();
	const session = await auth.api.getSession({ headers: event.request.headers });
	if (!session) throw new Error('Unauthorized');
	const activeOrgId = session.session.activeOrganizationId;
	if (!activeOrgId) throw new Error('No active organization');
	return activeOrgId;
}

export const get_rules = query(async () => {
	const orgId = await getOrgId();

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
		const orgId = await getOrgId();
		await db.insert(matchingRule).values({ id: generateId(), organizationId: orgId, pattern, ownerId });
		await get_rules().refresh();
	}
);

export const delete_rule = command(
	v.object({ id: v.string() }),
	async ({ id }) => {
		await getOrgId();
		await db.delete(matchingRule).where(eq(matchingRule.id, id));
		await get_rules().refresh();
	}
);
