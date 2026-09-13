import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { invitation, organization } from '$lib/schema';
import { eq } from 'drizzle-orm';

export const get_invitation = query(
	v.object({ id: v.string() }),
	async ({ id }) => {
		const [inv] = await db.select().from(invitation).where(eq(invitation.id, id));
		if (!inv) throw new Error('Invitation not found');

		if (inv.status !== 'pending' || inv.expiresAt < new Date()) {
			return { expired: true, status: inv.status, invitation: null };
		}

		const [org] = await db
			.select({ name: organization.name })
			.from(organization)
			.where(eq(organization.id, inv.organizationId));

		return {
			expired: false,
			status: inv.status,
			invitation: {
				id: inv.id,
				email: inv.email,
				role: inv.role ?? 'member',
				organizationName: org?.name ?? 'an organization'
			}
		};
	}
);

export const accept_invitation = command(
	v.object({ invitationId: v.string() }),
	async ({ invitationId }) => {
		const event = getRequestEvent();
		const session = await auth.api.getSession({ headers: event.request.headers });
		if (!session) throw new Error('Unauthorized');

		await auth.api.acceptInvitation({
			body: { invitationId },
			headers: event.request.headers
		});
	}
);
