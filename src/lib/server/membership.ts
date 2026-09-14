import { asc, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { member, user } from '$lib/schema';

/** The sameie a user lands in: the one they chose last if they're still a member, else their oldest membership. */
export async function landingMembership(userId: string): Promise<{ organizationId: string; role: string } | null> {
	const [row] = await db
		.select({ organizationId: member.organizationId, role: member.role })
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(eq(member.userId, userId))
		.orderBy(sql`${member.organizationId} = ${user.lastActiveOrganizationId} desc nulls last`, asc(member.createdAt), asc(member.organizationId))
		.limit(1);
	return row ?? null;
}
