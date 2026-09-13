import { error } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import { eq } from 'drizzle-orm';
import { auth } from './auth';
import { db } from './db';
import { member } from '$lib/schema';

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
