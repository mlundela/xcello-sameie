import { error } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import { and, count, eq, inArray } from 'drizzle-orm';
import { auth } from './auth';
import { db } from './db';
import { flat, ledgerAccount, member, owner } from '$lib/schema';

type Session = NonNullable<App.Locals['session']>;

/**
 * better-auth only clears activeOrganizationId when users remove themselves from an org.
 * A member removed by an admin keeps it, so every request would still resolve to that org.
 * Called from the handle hook: re-points such a session at a remaining membership, or none.
 */
export async function ensureActiveMembership(session: Session, headers: Headers) {
	const activeOrgId = session.session.activeOrganizationId;
	if (!activeOrgId) return;

	const memberships = await db
		.select({ organizationId: member.organizationId })
		.from(member)
		.where(eq(member.userId, session.user.id));
	if (memberships.some((m) => m.organizationId === activeOrgId)) return;

	const next = memberships[0]?.organizationId ?? null;
	await auth.api.setActiveOrganization({ body: { organizationId: next }, headers });
	session.session.activeOrganizationId = next;
}

export function requireSession(): Session {
	const { session } = getRequestEvent().locals;
	if (!session) error(401, 'Ikke innlogget');
	return session;
}

/** The active sameie. Membership is already verified by ensureActiveMembership in the hook. */
export function requireOrgId(): string {
	const orgId = requireSession().session.activeOrganizationId;
	if (!orgId) error(403, 'Ingen aktivt sameie');
	return orgId;
}

/** Throws 404 unless every id is a row of `table` in the org. Use on any id that comes from the client. */
export async function assertInOrg(
	table: typeof owner | typeof ledgerAccount | typeof flat,
	ids: string[],
	orgId: string
) {
	const unique = [...new Set(ids)];
	if (unique.length === 0) return;
	const [{ n }] = await db
		.select({ n: count() })
		.from(table)
		.where(and(eq(table.organizationId, orgId), inArray(table.id, unique)));
	if (n !== unique.length) error(404, 'Ikke funnet');
}
